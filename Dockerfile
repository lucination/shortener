# syntax=docker/dockerfile:1
# Index digests include amd64 and arm64; update intentionally with release review.
FROM --platform=$BUILDPLATFORM node:22-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS ui
WORKDIR /app
COPY web/package*.json web/
COPY admin/package*.json admin/
RUN npm ci --prefix web --no-audit --no-fund && npm ci --prefix admin --no-audit --no-fund
COPY web/ web/
COPY admin/ admin/
COPY contracts/ contracts/
RUN npm --prefix web run check-contracts && npm --prefix web run build && npm --prefix admin run build && cp -r admin/build web/build/_

# Native musl toolchain: each target requires its own native builder (no QEMU).
FROM --platform=$TARGETPLATFORM rust:1-alpine3.24@sha256:2cccd8b212b37dad15a555589c1b6787da4ab913fe24d8a9b2d99d3498869409 AS backend
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconf binutils
ENV OPENSSL_STATIC=1
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
COPY migration/ migration/
RUN cargo build --release --locked --bin shortener -j1 && cp target/release/shortener /shortener \
    && readelf -h /shortener \
    && ! readelf -l /shortener | grep -q INTERP \
    && ! readelf -d /shortener | grep -q NEEDED

FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS runtime
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF
RUN apk add --no-cache ca-certificates curl \
    && mkdir -p /app/data && chown -R 10001:10001 /app
WORKDIR /app
COPY --from=backend /shortener /usr/local/bin/shortener
COPY --chmod=755 packaging/healthcheck.sh /usr/local/bin/healthcheck
COPY --from=ui /app/web/build /app/static
COPY config/production.yaml /app/config/production.yaml
COPY web/THIRD-PARTY-NOTICES.md /app/THIRD-PARTY-NOTICES.md
ENV DATABASE_PATH=/app/data/shortener.sqlite STATIC_DIR=/app/static
USER 10001:10001
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/usr/local/bin/healthcheck"]
CMD ["shortener", "start", "--environment", "production", "--binding", "0.0.0.0", "--port", "3000", "--no-banner"]

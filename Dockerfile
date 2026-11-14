# syntax=docker/dockerfile:1
# Index digests include amd64 and arm64; update intentionally with release review.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS ui
WORKDIR /app
COPY web/package*.json web/
COPY admin/package*.json admin/
RUN npm ci --prefix web --no-audit --no-fund && npm ci --prefix admin --no-audit --no-fund
COPY web/ web/
COPY admin/ admin/
COPY contracts/ contracts/
RUN npm --prefix web run check-contracts && npm --prefix web run build && npm --prefix admin run build && cp -r admin/build web/build/_

FROM --platform=$BUILDPLATFORM rust:1-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea AS toolchain
ARG TARGETARCH
COPY packaging/toolchain.sh /toolchain.sh
RUN sh /toolchain.sh

# Fast prerequisites-only target: no application compilation, Node, or QEMU.
FROM toolchain AS cross-probe
COPY packaging/probe.sh /probe.sh
RUN sh /probe.sh

FROM toolchain AS backend
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
COPY migration/ migration/
RUN . /target-env && cargo build --release --locked --target "$RUST_TARGET" --bin shortener -j1 && cp "target/$RUST_TARGET/release/shortener" /shortener

# No target-platform RUN: assembly works even without binfmt/QEMU.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS runtime
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF
COPY --from=toolchain /runtime/ /
COPY --from=toolchain --chown=10001:10001 /runtime/app/ /app/
WORKDIR /app
COPY --from=backend /shortener /usr/local/bin/shortener
COPY --from=ui /app/web/build /app/static
COPY config/production.yaml /app/config/production.yaml
COPY web/THIRD-PARTY-NOTICES.md /app/THIRD-PARTY-NOTICES.md
ENV DATABASE_PATH=/app/data/shortener.sqlite STATIC_DIR=/app/static
USER 10001:10001
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["shortener", "start", "--environment", "production", "--binding", "0.0.0.0", "--port", "3000", "--no-banner"]

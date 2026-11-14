FROM node:22-bookworm-slim AS ui
WORKDIR /app
COPY web/package*.json web/
COPY admin/package*.json admin/
RUN npm ci --prefix web --no-audit --no-fund && npm ci --prefix admin --no-audit --no-fund
COPY web/ web/
COPY admin/ admin/
COPY contracts/ contracts/
RUN npm --prefix web run check-contracts && npm --prefix web run build && npm --prefix admin run build && cp -r admin/build web/build/_

FROM rust:1-bookworm AS backend
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
COPY migration/ migration/
RUN cargo build --release --locked --bin shortener -j1

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home app && mkdir -p /app/data && chown -R app:app /app
WORKDIR /app
COPY --from=backend /app/target/release/shortener /usr/local/bin/shortener
COPY --from=ui /app/web/build /app/static
COPY config/production.yaml /app/config/production.yaml
COPY web/THIRD-PARTY-NOTICES.md /app/THIRD-PARTY-NOTICES.md
ENV DATABASE_PATH=/app/data/shortener.sqlite STATIC_DIR=/app/static
USER 10001:10001
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["shortener", "start", "--environment", "production", "--binding", "0.0.0.0", "--port", "3000", "--no-banner"]

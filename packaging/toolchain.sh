#!/bin/sh
# Runs only on BUILDPLATFORM. No target executable is run during image assembly.
set -eu
case "$TARGETARCH" in
  amd64) triple=x86_64-linux-gnu; rust_target=x86_64-unknown-linux-gnu; compiler=gcc-x86-64-linux-gnu ;;
  arm64) triple=aarch64-linux-gnu; rust_target=aarch64-unknown-linux-gnu; compiler=gcc-aarch64-linux-gnu ;;
  *) echo 'Only linux/amd64 and linux/arm64 are supported' >&2; exit 1 ;;
esac
if [ "$(dpkg --print-architecture)" = "$TARGETARCH" ]; then compiler=gcc; fi
dpkg --add-architecture "$TARGETARCH"
apt-get update
apt-get install -y --no-install-recommends "$compiler" "libc6-dev:$TARGETARCH" "libssl-dev:$TARGETARCH" ca-certificates pkg-config binutils
rm -rf /var/lib/apt/lists/*
rustup target add "$rust_target"
mkdir -p /runtime/usr/lib /runtime/app/data /runtime/etc/ssl/certs
cp -L "/usr/lib/$triple/libssl.so.3" "/usr/lib/$triple/libcrypto.so.3" "/usr/lib/$triple/libgcc_s.so.1" /runtime/usr/lib/
cp /etc/ssl/certs/ca-certificates.crt /runtime/etc/ssl/certs/
chown -R 10001:10001 /runtime/app
cat > /target-env <<EOF
export RUST_TARGET=$rust_target
export CARGO_TARGET_$(echo "$rust_target" | tr '[:lower:]-' '[:upper:]_')_LINKER=$triple-gcc
export CC=$triple-gcc
export AR=$triple-ar
export OPENSSL_LIB_DIR=/usr/lib/$triple
export OPENSSL_INCLUDE_DIR=/usr/include
EOF

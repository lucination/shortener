#!/bin/sh
set -eu
. /target-env
# Both C headers/sysroot and Rust std/linker/OpenSSL closure must work.
printf '#include <openssl/ssl.h>\nint main(void) { return OPENSSL_init_ssl(0, 0) == 0; }\n' > /probe.c
"$CC" /probe.c -lssl -lcrypto -o /probe-c
printf 'unsafe extern "C" { fn OpenSSL_version_num() -> u64; }\nfn main() { println!("{}", unsafe { OpenSSL_version_num() }); }\n' > /probe.rs
rustc --edition 2024 --target "$RUST_TARGET" -C "linker=$CC" -L "$OPENSSL_LIB_DIR" -l ssl -l crypto /probe.rs -o /probe-rust
readelf -h /probe-c /probe-rust
readelf -d /probe-rust
test -s /runtime/usr/lib/libssl.so.3
test -s /runtime/usr/lib/libcrypto.so.3
test -s /runtime/etc/ssl/certs/ca-certificates.crt

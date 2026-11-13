#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Builds taalcut-c2pa for linux-x64 (the `c2pa-sidecar` component's linux-x64 artifact) in a pinned Ubuntu 22.04
# container (glibc 2.35), and stages it as native/c2pa-sidecar/build.sh stages the macOS one:
#
#   tools/components/linux/build-c2pa.sh
#
# writes native/c2pa-sidecar/target/linux-x64/stage/{taalcut-c2pa,LICENSES/} (hosting's c2pa recipe adds
# LICENSES/THIRD-PARTY-CRATES.txt and packs it).
#
# - Rust 1.97.1 (the host's rustup toolchain, mounted read-only; rustup builds it against glibc 2.17, so it runs in
#   the container), cargo build --release --locked --offline.
# - Every crate Cargo.lock names is vendored on the host first (cargo vendor --locked, checked by the lock file's
#   checksums); the container has no network.
# - The image is tools/whisper/versions.env's LINUX_BUILD_IMAGE (by digest): Ubuntu 22.04 with gcc 11 as the
#   linker. Paths are fixed inside the container (/src, /vendor, /build) and remapped, and there is no build id, so a
#   second build gives the same binary.
# - Capped: TAALCUT_BUILD_CPUS (default 12), TAALCUT_BUILD_MEMORY (16g); the container is taalcut-c2pa-<pid>, removed
#   when it ends.
set -eu
LINUX_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$LINUX_DIR/lib.sh"
# shellcheck disable=SC1091
. "$ROOT/tools/whisper/versions.env"

RUST_VERSION=1.97.1
TOOLCHAIN="${RUSTUP_HOME:-$HOME/.rustup}/toolchains/$RUST_VERSION-x86_64-unknown-linux-gnu"
[ -x "$TOOLCHAIN/bin/cargo" ] || die "no Rust $RUST_VERSION toolchain (rustup toolchain install $RUST_VERSION)"
CRATE="$ROOT/native/c2pa-sidecar"
OUT="$CRATE/target/linux-x64"
# The vendored crates and the build stay in the cache, outside the source tree the linters walk.
WORK="$CACHE/c2pa"

rm -rf "$WORK/vendor" "$WORK/build/cargo-home" "$OUT/stage"
mkdir -p "$WORK/build/cargo-home" "$OUT/stage/LICENSES"
(cd "$CRATE" && "$TOOLCHAIN/bin/cargo" vendor --locked --versioned-dirs "$WORK/vendor" >/dev/null)
cat >"$WORK/build/cargo-home/config.toml" <<'EOF'
[source.crates-io]
replace-with = "vendored"

[source.vendored]
directory = "/vendor"
EOF

docker run --rm --name "taalcut-c2pa-$$" \
  --cpus="${TAALCUT_BUILD_CPUS:-12}" --memory="${TAALCUT_BUILD_MEMORY:-16g}" --network none \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CARGO_HOME=/build/cargo-home -e SOURCE_DATE_EPOCH=0 \
  -e CARGO_BUILD_JOBS="${JOBS:-12}" -e PATH=/opt/rust/bin:/usr/bin:/bin \
  -e RUSTFLAGS="--remap-path-prefix=/src=taalcut-c2pa --remap-path-prefix=/vendor=crates -C link-arg=-Wl,--build-id=none" \
  -v "$TOOLCHAIN:/opt/rust:ro" -v "$CRATE:/src:ro" -v "$WORK/vendor:/vendor:ro" -v "$WORK/build:/build" \
  -w /src "$LINUX_BUILD_IMAGE" \
  cargo build --release --locked --offline --target-dir /build/target

cp "$WORK/build/target/release/taalcut-c2pa" "$OUT/stage/taalcut-c2pa"
cp "$CRATE"/LICENSES/* "$OUT/stage/LICENSES/"
cp "$CRATE/certs/README.md" "$OUT/stage/LICENSES/test-certificate.md"
chmod 0755 "$OUT/stage/taalcut-c2pa"
chmod 0644 "$OUT/stage/LICENSES"/*
ELF="$(check_elf_tree "$OUT/stage" 2.35)"
[ "$ELF" = 1 ] || die "expected one ELF file in the stage, found $ELF"
echo "{\"binary\":\"$OUT/stage/taalcut-c2pa\",\"sha256\":\"$(sha256_of "$OUT/stage/taalcut-c2pa")\",\"rust\":\"$RUST_VERSION\"}"

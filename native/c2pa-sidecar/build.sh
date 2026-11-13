#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Builds taalcut-c2pa and packs the `c2pa-sidecar` component (render SPEC P3.3):
#   dist/taalcut-c2pa                                  the binary, ad-hoc signed with the hardened runtime
#   dist/c2pa-sidecar-<version>-darwin-arm64.tar.gz    the component archive (binary at the top, LICENSES/)
# and prints the archive's sha256, size and extractedSize for tools/components/manifest.render.provisional.json.
#
# Ad-hoc signing is for development only. Before release (H2, the release lane): sign dist/taalcut-c2pa with
# the Developer ID, hardened runtime and a secure timestamp, notarise it with the app, repack, host the
# archive under a versioned URL and record the new sha256 and size in the manifest.
set -eu
cd "$(dirname "$0")"

VERSION=$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)
ARCHIVE="c2pa-sidecar-${VERSION}-darwin-arm64.tar.gz"

cargo build --release --locked
rm -rf dist
mkdir -p dist/stage/LICENSES
cp target/release/taalcut-c2pa dist/taalcut-c2pa
codesign --force --sign - --options runtime dist/taalcut-c2pa
cp dist/taalcut-c2pa dist/stage/taalcut-c2pa
cp LICENSES/* dist/stage/LICENSES/
cp certs/README.md dist/stage/LICENSES/test-certificate.md
chmod 0755 dist/stage/taalcut-c2pa
chmod 0644 dist/stage/LICENSES/*
# Reproducible archive: sorted names, numeric root owner, no macOS metadata, every mtime the epoch.
find dist/stage -exec touch -h -t 197001010000 {} +
(cd dist/stage && find . -type f | sed 's|^\./||' | LC_ALL=C sort > ../files.txt)
COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --numeric-owner --no-xattrs --no-mac-metadata --no-acls --no-fflags \
  -cf - -C dist/stage -T dist/files.txt | gzip -n -9 > "dist/${ARCHIVE}"

SHA=$(shasum -a 256 "dist/${ARCHIVE}" | cut -d' ' -f1)
SIZE=$(stat -f %z "dist/${ARCHIVE}")
EXTRACTED=0
while IFS= read -r file; do EXTRACTED=$((EXTRACTED + $(stat -f %z "dist/stage/${file}"))); done < dist/files.txt
echo "{\"archive\":\"dist/${ARCHIVE}\",\"sha256\":\"${SHA}\",\"size\":${SIZE},\"extractedSize\":${EXTRACTED}}"

#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the linux-x64 artifact of `hyperframes-headless-shell`: Chrome for Testing's chrome-headless-shell
# 157.0.8103.50 for linux64, unchanged, repacked as tar.zst (the component manager reads no zip).
#
#   tools/components/linux/pack-headless-shell.sh [out-dir]
#
# - The zip is pinned by size and sha256 (Chrome for Testing publishes no checksum; the pin was taken on 11 Nov 2026
#   and its md5 matched the x-goog-hash Google's bucket serves). Nothing reads it before that check, and it is
#   unzipped into a fresh empty folder.
# - The same version as the darwin-arm64 artifact (packages/render/scripts/fetch-shell.mjs, HEADLESS_SHELL in
#   packages/render/src/engine/headless-shell.ts). Layout is the zip's: chrome-headless-shell-linux64/ at the top.
# - Every ELF file is checked against glibc 2.35 (Ubuntu 22.04) with no search path outside the shell's folder. The
#   shell links the system's NSS, NSPR, D-Bus, expat, GBM, X11 and xkbcommon libraries dynamically (deb.deps in the
#   archive lists Chrome's package dependencies).
# Prints the summary JSON last.
set -eu
LINUX_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$LINUX_DIR/lib.sh"

VERSION=157.0.8103.50
OUT="${1:-$CACHE/out}"
ARCHIVE="$OUT/chrome-headless-shell-$VERSION-linux64.tar.zst"
ZIP_URL="https://storage.googleapis.com/chrome-for-testing-public/$VERSION/linux64/chrome-headless-shell-linux64.zip"
ZIP_SHA256=7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f
ZIP_SIZE=128166087
TOP=chrome-headless-shell-linux64

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/zip" "$WORK/stage"

ZIP="$(fetch_pin "$ZIP_URL" "$ZIP_SHA256" "$ZIP_SIZE")"
unzip -q "$ZIP" -d "$WORK/zip"
[ "$(ls -A "$WORK/zip")" = "$TOP" ] || die "the zip holds more than $TOP/"
[ -x "$WORK/zip/$TOP/chrome-headless-shell" ] || die "no executable $TOP/chrome-headless-shell in the zip"
mv "$WORK/zip/$TOP" "$WORK/stage/$TOP"

ELF="$(check_elf_tree "$WORK/stage" 2.35)"
EXTRACTED="$(pack_tree "$WORK/stage" "$ARCHIVE")"
summary "$ARCHIVE" "$EXTRACTED" "\"elfFiles\":$ELF"

#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Installs the development AppArmor profiles (taalcut-dev.apparmor) so `pnpm dev`, the e2e tests and HyperFrames
# renders keep Chromium's sandbox on, on Ubuntu 23.10 and later. Run it once, as root:
#
#   sudo apps/desktop/scripts/linux/install-apparmor-dev.sh
#
# It survives `pnpm install`, since the profiles match by path. Remove with:
#   sudo apparmor_parser -R /etc/apparmor.d/taalcut-dev && sudo rm /etc/apparmor.d/taalcut-dev
set -eu

here=$(dirname "$(readlink -f "$0")")
target=/etc/apparmor.d/taalcut-dev

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
command -v apparmor_parser >/dev/null || { echo "apparmor_parser not found: is AppArmor installed?" >&2; exit 1; }

install -m 0644 "$here/taalcut-dev.apparmor" "$target"
apparmor_parser -r "$target"
echo "Loaded taalcut-dev-electron and taalcut-dev-headless-shell from $target."

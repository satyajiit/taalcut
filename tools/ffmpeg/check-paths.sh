#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Fail when a shipped file embeds a path of the machine that built it: a home
# directory, a temp directory, this checkout, or the account name.
# build.sh runs it on dist/ before writing BUILDINFO.json; verify.sh runs it too.
# Usage: check-paths.sh file...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
[[ $# -gt 0 ]] || { echo "usage: $(basename "$0") file..." >&2; exit 2; }

patterns=(/Users/ /home/ /private/tmp/ /private/var/ /var/folders/ "$ROOT")
if [[ -n "${HOME:-}" && "$HOME" != "/" ]]; then
  patterns+=("$HOME")
fi
# Generic account names are ordinary words in the binaries; skip them.
user="$(id -un)"
case "$user" in
  root | user | admin | build) user="" ;;
esac

status=0
for file in "$@"; do
  [[ -f "$file" ]] || { echo "FAIL: $file is missing" >&2; exit 1; }
  text="$(strings -a "$file")"
  bad=0
  for pattern in "${patterns[@]}"; do
    if hits="$(printf '%s\n' "$text" | grep -F -- "$pattern")"; then
      echo "FAIL: $(basename "$file") contains $pattern:" >&2
      printf '%s\n' "$hits" | head -5 | cut -c1-160 >&2
      bad=1
    fi
  done
  if [[ -n "$user" ]] && hits="$(printf '%s\n' "$text" | grep -w -F -- "$user")"; then
    echo "FAIL: $(basename "$file") contains the account name $user:" >&2
    printf '%s\n' "$hits" | head -5 | cut -c1-160 >&2
    bad=1
  fi
  if [[ "$bad" -eq 0 ]]; then
    echo "no build paths in $(basename "$file")"
  else
    status=1
  fi
done
exit "$status"

#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The .deb's postrm (packaging/linux.ts), filled in by electron-builder: ${executable} and ${sanitizedProductName}
# are its macros, so shell variables here are written without braces.
#
# dpkg runs it with "remove", "purge", "upgrade", "failed-upgrade", "abort-install", "abort-upgrade" or
# "disappear". Only remove and purge take anything away: an upgrade keeps the command and the AppArmor profile, and
# the new version's postinst installs its own. The profile goes on remove, not only purge: it gives programs at
# those paths user namespaces, which must not outlive the app.

app_dir='/opt/${sanitizedProductName}'
executable='${executable}'
profile_target="/etc/apparmor.d/$executable"

case "$1" in
  remove | purge)
    if type update-alternatives >/dev/null 2>&1; then
      update-alternatives --remove "$executable" "$app_dir/$executable" || true
    fi
    # A link electron-builder's fallback made by hand.
    if [ -L "/usr/bin/$executable" ] && [ ! -e "/usr/bin/$executable" ]; then
      rm -f "/usr/bin/$executable"
    fi
    if [ -f "$profile_target" ]; then
      # Unloaded before it is deleted, so the policy isn't left in the kernel until the next boot.
      if apparmor_status --enabled >/dev/null 2>&1 && hash apparmor_parser 2>/dev/null &&
        ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
        apparmor_parser --remove "$profile_target" || true
      fi
      rm -f "$profile_target"
    fi
    ;;
  *) ;;
esac

exit 0

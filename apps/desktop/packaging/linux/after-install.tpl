#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The .deb's postinst (packaging/linux.ts), filled in by electron-builder: ${executable} and
# ${sanitizedProductName} are its macros, so shell variables here are written without braces.
# Runs as root after every unpack ("configure"), the first install and each upgrade alike.

app_dir='/opt/${sanitizedProductName}'
executable='${executable}'

# The command: /usr/bin/taalcut through update-alternatives, as electron-builder's own script does.
if type update-alternatives >/dev/null 2>&1; then
  # Replace a link an older package made by hand.
  if [ -L "/usr/bin/$executable" ] && [ "$(readlink "/usr/bin/$executable")" != "/etc/alternatives/$executable" ]; then
    rm -f "/usr/bin/$executable"
  fi
  update-alternatives --install "/usr/bin/$executable" "$executable" "$app_dir/$executable" 100 ||
    ln -sf "$app_dir/$executable" "/usr/bin/$executable"
else
  ln -sf "$app_dir/$executable" "/usr/bin/$executable"
fi

# Chromium's setuid sandbox helper, always: root-owned and 4755. It is the sandbox wherever the kernel refuses this
# program a user namespace (no AppArmor profile loaded, a hardened kernel). electron-builder's script sets it only
# when root can't make a user namespace, which root always can on Ubuntu 24.04, so it would leave it 0755 there.
chown root:root "$app_dir/chrome-sandbox"
chmod 4755 "$app_dir/chrome-sandbox"

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# The AppArmor profile (Ubuntu 23.10 and later restrict unprivileged user namespaces to programs with one): the app
# and the headless shell it renders with get userns, unconfined otherwise, like Ubuntu's own chrome profile.
# AppArmor 3 (Ubuntu 22.04) can't read the profile's abi 4.0 and doesn't restrict user namespaces: skipped there.
profile_source="$app_dir/resources/apparmor-profile"
profile_target="/etc/apparmor.d/$executable"
if apparmor_status --enabled >/dev/null 2>&1 && hash apparmor_parser 2>/dev/null; then
  if apparmor_parser --skip-kernel-load --skip-cache --debug "$profile_source" >/dev/null 2>&1; then
    install -m 0644 "$profile_source" "$profile_target"
    # Not inside a chroot (an image being built): there is no running kernel policy to update.
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
      # -W -T as dh_apparmor does: write the cache, and pull in any abstraction it includes afresh.
      apparmor_parser --replace --write-cache --skip-read-cache "$profile_target" ||
        echo "Taalcut: could not load $profile_target; the setuid chrome-sandbox keeps the sandbox on." >&2
    fi
  else
    echo "Taalcut: this AppArmor can't read $profile_source (Ubuntu 22.04's has no abi 4.0); not installed." >&2
  fi
fi

exit 0

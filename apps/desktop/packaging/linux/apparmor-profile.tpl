# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# /etc/apparmor.d/${executable}, installed and loaded by the .deb's postinst (packaging/linux.ts). Ubuntu 23.10 and
# later let only programs with an AppArmor profile make the unprivileged user namespaces Chromium's sandbox needs
# (kernel.apparmor_restrict_unprivileged_userns=1). These profiles confine nothing (flags=unconfined, like Ubuntu's
# own chrome and code profiles): they name three programs and allow them user namespaces, so the sandboxes run.
#
# - the app: Electron's main process and every child it starts (renderers, the GPU process, utility processes);
# - the headless Chrome the render process starts from the hyperframes-headless-shell component, which the
#   component manager installs under userData (~/.config/Taalcut):
#   components/installed/hyperframes-headless-shell/<version>/chrome-headless-shell-linux64/chrome-headless-shell.
#   An attachment can't follow $XDG_CONFIG_HOME, so a config folder moved elsewhere gets no profile.
#   This path is in the user's own folder, so whatever a user puts there gets user namespaces too: a loosening of
#   the 24.04 hardening for that user. apps/desktop/SPEC.md,
#   "The Linux package", says why it is there and what would remove it.
# - bubblewrap (/usr/bin/bwrap, the package's Depends), which confines the agent's workspace shell in namespaces of
#   its own (AGT2 sbx). Any program that runs bwrap gets user namespaces through it: the same loosening of the
#   24.04 hardening, for bwrap. apps/desktop/SPEC.md, "The Linux package", says why and what would narrow it.

abi <abi/4.0>,
include <tunables/global>

profile ${executable} /opt/${sanitizedProductName}/${executable} flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}

profile ${executable}-headless-shell /home/*/.config/${sanitizedProductName}/components/installed/hyperframes-headless-shell/**/chrome-headless-shell flags=(unconfined) {
  userns,

  include if exists <local/${executable}-headless-shell>
}

profile ${executable}-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,

  include if exists <local/${executable}-bwrap>
}

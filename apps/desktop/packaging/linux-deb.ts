// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a built .deb must hold, as data and pure checks, for the builder config (linux.ts) and for
 * scripts/linux/verify-deb.mjs, which reads a package with dpkg-deb and hands the parts here. It imports nothing
 * (no bare specifiers), so a plain .mjs script can import this file as it is (Node strips the types).
 */

/** The command, the /usr/bin link and the desktop file's name. */
export const LINUX_EXECUTABLE = 'taalcut';
/** The Debian package name. */
export const DEB_PACKAGE = 'taalcut';
/** Where the package installs the app (electron-builder's /opt/<sanitized product name>). */
export const INSTALL_DIR = '/opt/Taalcut';

/**
 * What the package depends on, by Ubuntu 24.04's names with 22.04's as the alternative where the 64-bit time_t
 * transition renamed a library (24.04's t64 packages also provide the old names). From the NEEDED entries of:
 * - Electron 44: GTK 3, NSS and NSPR, ATK, AT-SPI, CUPS, D-Bus, Cairo, Pango, GBM, ALSA, udev, expat, X11 and
 *   xkbcommon; plus electron-builder's defaults (libnotify, libXss, libXtst, xdg-utils, libuuid, libsecret: the
 *   vault's keyring);
 * - the hyperframes-headless-shell component (Chromium 152): the same set, without GTK;
 * - the llama.cpp builds (tools/components/README.md): libgomp, OpenSSL 3 and the Vulkan loader, which libplacebo
 *   in the bundled FFmpeg also uses;
 * - the bundled FFmpeg (tools/ffmpeg/build-linux.sh): the Vulkan loader, and libva with libva-drm for VA-API (its
 *   libraries link them; the NVIDIA libraries are opened at run time, so no driver is a dependency);
 * - glibc 2.35, Ubuntu 22.04's: the components and the bundled FFmpeg are built for it;
 * - bubblewrap, which confines the agent's workspace shell (AGT2 sbx; packages/tools bwrap.ts). It is the
 *   distribution's (LGPL-2.0-or-later), never shipped in the package.
 */
export const DEB_DEPENDS: readonly string[] = [
  'libc6 (>= 2.35)',
  'libgtk-3-0t64 | libgtk-3-0',
  'libnss3',
  'libnspr4',
  'libatk1.0-0t64 | libatk1.0-0',
  'libatk-bridge2.0-0t64 | libatk-bridge2.0-0',
  'libatspi2.0-0t64 | libatspi2.0-0',
  'libcups2t64 | libcups2',
  'libdbus-1-3',
  'libglib2.0-0t64 | libglib2.0-0',
  'libcairo2',
  'libpango-1.0-0',
  'libgbm1',
  'libdrm2',
  'libasound2t64 | libasound2',
  'libudev1',
  'libexpat1',
  'libx11-6',
  'libxcb1',
  'libxcomposite1',
  'libxdamage1',
  'libxext6',
  'libxfixes3',
  'libxrandr2',
  'libxkbcommon0',
  'libnotify4',
  'libxss1',
  'libxtst6',
  'libuuid1',
  'xdg-utils',
  'libsecret-1-0',
  'libgomp1',
  'libssl3t64 | libssl3',
  'libvulkan1',
  'libva2',
  'libva-drm2',
  'bubblewrap',
];

/** Files the package must install, under INSTALL_DIR unless absolute. */
export const DEB_REQUIRED_FILES: readonly string[] = [
  LINUX_EXECUTABLE,
  'chrome-sandbox',
  'resources/app.asar',
  'resources/apparmor-profile',
  'resources/manifest.signed.json',
  'resources/ffmpeg/bin/ffmpeg',
  'resources/ffmpeg/bin/ffprobe',
  'resources/ffmpeg/lib/libavcodec.so.63',
  'resources/ffmpeg/lib/libavfilter.so.12',
  'resources/ffmpeg/lib/libavformat.so.63',
  'resources/ffmpeg/lib/libavutil.so.61',
  'resources/ffmpeg/BUILDINFO.json',
  'resources/ffmpeg/LICENSE.txt',
  `/usr/share/applications/${LINUX_EXECUTABLE}.desktop`,
  `/usr/share/icons/hicolor/512x512/apps/${LINUX_EXECUTABLE}.png`,
];

/** Pieces of the macOS build that must not ship in the .deb. */
const MAC_ONLY = [/taalcut-mac-helper/, /\.sb$/, /\.lproj\//, /MoltenVK/, /\.dylib$/];

/** One line of `dpkg-deb -c`: mode, owner/group, size, date, time, path (and `-> target` for a link). */
export interface DebEntry {
  readonly mode: string;
  readonly owner: string;
  readonly path: string;
}

export function parseDebListing(listing: string): DebEntry[] {
  return listing
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [mode = '', owner = '', , , , ...rest] = line.trim().split(/\s+/);
      const path = rest
        .join(' ')
        .replace(/ -> .*$/, '')
        .replace(/^\./, '');
      return { mode, owner, path: path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path };
    });
}

/** The fields of a control file (`dpkg-deb -f`), continuation lines joined. */
export function parseControl(control: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let last: string | undefined;
  for (const line of control.split('\n')) {
    if (/^\s/.test(line) && last) fields[last] += `\n${line.trim()}`;
    else {
      const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (match) fields[(last = match[1]!)] = match[2]!;
    }
  }
  return fields;
}

export interface DebParts {
  readonly control: string;
  readonly listing: string;
  readonly postinst: string;
  readonly postrm: string;
}

/** Every problem with a built package; empty when it is what LNX1-PKG ships. */
export function debProblems(parts: DebParts): string[] {
  const problems: string[] = [];
  const control = parseControl(parts.control);
  if (control.Package !== DEB_PACKAGE) problems.push(`Package is ${control.Package}, not ${DEB_PACKAGE}`);
  if (control.Architecture !== 'amd64') problems.push(`Architecture is ${control.Architecture}, not amd64`);
  const depends = (control.Depends ?? '').split(',').map((dep) => dep.trim());
  for (const dep of DEB_DEPENDS) if (!depends.includes(dep)) problems.push(`Depends lacks ${dep}`);

  const entries = parseDebListing(parts.listing);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const file of DEB_REQUIRED_FILES) {
    const path = file.startsWith('/') ? file : `${INSTALL_DIR}/${file}`;
    if (!byPath.has(path)) problems.push(`${path} is not in the package`);
  }
  for (const entry of entries) {
    // dpkg-deb lists owners by name or, for a tarball written with numeric owners, by id.
    if (!/^(root|0)\/(root|0)$/.test(entry.owner))
      problems.push(`${entry.path} is owned by ${entry.owner}, not root/root`);
    if (MAC_ONLY.some((pattern) => pattern.test(entry.path))) problems.push(`${entry.path} is a macOS piece`);
  }
  for (const binary of [LINUX_EXECUTABLE, 'resources/ffmpeg/bin/ffmpeg', 'resources/ffmpeg/bin/ffprobe']) {
    const mode = byPath.get(`${INSTALL_DIR}/${binary}`)?.mode;
    if (mode && !/^-rwxr-xr-x$/.test(mode))
      problems.push(`${INSTALL_DIR}/${binary} is ${mode}, not executable`);
  }

  if (!new RegExp(`^app_dir='${INSTALL_DIR}'$`, 'm').test(parts.postinst))
    problems.push(`postinst doesn't name ${INSTALL_DIR}`);
  if (
    !/^chown root:root "\$app_dir\/chrome-sandbox"\nchmod 4755 "\$app_dir\/chrome-sandbox"$/m.test(
      parts.postinst,
    )
  )
    problems.push("postinst doesn't make chrome-sandbox setuid root");
  if (!/apparmor_parser --replace .*"\$profile_target"/.test(parts.postinst))
    problems.push("postinst doesn't load the AppArmor profile");
  if (!/^\s+remove \| purge\)$/m.test(parts.postrm) || !/apparmor_parser --remove/.test(parts.postrm))
    problems.push("postrm doesn't unload the AppArmor profile on remove and purge");
  return problems;
}

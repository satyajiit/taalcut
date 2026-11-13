// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Linux package (LNX1-PKG): an x64 .deb for Ubuntu 22.04 and 24.04, installed at /opt/Taalcut with
 * /usr/bin/taalcut, a desktop entry and the hicolor icons.
 *
 * The sandbox. Ubuntu 23.10 and later let only programs with an AppArmor profile make the unprivileged user
 * namespaces Chromium's sandbox needs (kernel.apparmor_restrict_unprivileged_userns=1). The package does both of
 * the usual things, so the sandbox stays on either way:
 * - chrome-sandbox is setuid root (4755) after every install. electron-builder's own script does that only when the
 *   root shell running it can't make a user namespace, which on 24.04 it always can, so it would leave 0755.
 * - linux/apparmor-profile.tpl, installed as /etc/apparmor.d/taalcut and loaded by the postinst, names the app's
 *   binary and the headless shell the render process starts from the hyperframes-headless-shell component, like
 *   Ubuntu's own chrome profile: unconfined, with userns. 22.04's AppArmor 3 can't read abi 4.0, so the postinst
 *   skips the profile there (22.04 doesn't restrict user namespaces).
 * The postrm unloads and deletes the profile when the package is removed or purged, never on an upgrade.
 *
 * The scripts are templates electron-builder fills (`${executable}`, `${sanitizedProductName}`): shell variables in
 * them are written `$name`, never with braces, which the template engine would take for its own.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DebOptions, FileSet, LinuxConfiguration } from 'electron-builder';
import { FFMPEG_BUILD_TARGETS } from '@taalcut/media';
import { DEB_DEPENDS, DEB_PACKAGE, LINUX_EXECUTABLE } from './linux-deb';

export { DEB_DEPENDS, DEB_PACKAGE, LINUX_EXECUTABLE } from './linux-deb';

export const LINUX_TEMPLATES = join('packaging', 'linux');
/** The source of /etc/apparmor.d/taalcut (an electron-builder template). */
export const APPARMOR_TEMPLATE = join(LINUX_TEMPLATES, 'apparmor-profile.tpl');

/** A Debian maintainer needs an address; this one is a placeholder until the owner names the real one. */
export const DEB_MAINTAINER = 'Taalcut contributors <packages@taalcut.app>';

const LINUX_ICONS = join('..', '..', 'design', 'logo', 'kit', 'app-icon', 'linux');

/** The linux and deb sections of the builder config. */
export function linuxConfig(projectDir: string): { linux: LinuxConfiguration; deb: DebOptions } {
  const icons = join(projectDir, LINUX_ICONS);
  return {
    linux: {
      target: [{ target: 'deb', arch: ['x64'] }],
      executableName: LINUX_EXECUTABLE,
      // Video editing first; AudioVideo is the main category the menu files it under.
      category: 'AudioVideo;Video;AudioVideoEditing',
      synopsis: 'Short-form videos from your footage, in the structure of a reel you like',
      // Wrapped for the control file, whose extended description lines stay under 80 characters.
      description:
        'Taalcut turns your footage into short-form videos by copying the structure\n' +
        'of a reference reel. It runs on your computer and keeps your media there.',
      maintainer: DEB_MAINTAINER,
      vendor: 'Taalcut contributors',
      ...(existsSync(icons) ? { icon: icons } : {}),
      // No MimeType: the app opens nothing from its command line.
      desktop: { entry: { Keywords: 'video;editor;reels;shorts;captions;' } },
      extraResources: linuxResources(projectDir),
      // The Linux updater comes later (plan/linux-round-1.md): no latest-linux.yml, no resources/app-update.yml.
      publish: null,
    },
    deb: {
      packageName: DEB_PACKAGE,
      // taalcut_<version>_amd64.deb, Debian's own naming (electron-builder would use the npm name, @taalcut/desktop).
      artifactName: `${DEB_PACKAGE}_\${version}_\${arch}.\${ext}`,
      depends: [...DEB_DEPENDS],
      // electron-builder's default recommends libappindicator3-1; Taalcut shows no tray icon.
      recommends: [],
      priority: 'optional',
      // Debian's section for it (fpm would write "default").
      packageCategory: 'video',
      // /usr/share/doc/taalcut: the copyright file Debian asks for, the AGPL, and the NOTICE of what ships with it.
      fpm: docFiles(projectDir),
      afterInstall: join(LINUX_TEMPLATES, 'after-install.tpl'),
      afterRemove: join(LINUX_TEMPLATES, 'after-remove.tpl'),
      appArmorProfile: APPARMOR_TEMPLATE,
    },
  };
}

/** fpm source=destination pairs for /usr/share/doc/taalcut. */
export function docFiles(projectDir: string): string[] {
  const doc = `/usr/share/doc/${DEB_PACKAGE}`;
  return [
    `${join(projectDir, LINUX_TEMPLATES, 'copyright')}=${doc}/copyright`,
    `${join(projectDir, '..', '..', 'LICENSE')}=${doc}/LICENSE`,
    `${join(projectDir, '..', '..', 'NOTICE')}=${doc}/NOTICE`,
  ];
}

/** Where the Linux FFmpeg lives in a checkout: tools/ffmpeg/dist/linux-x64 (tools/ffmpeg/build-linux.sh). */
export function linuxFfmpegSource(projectDir: string): string {
  return join(projectDir, '..', '..', 'tools', 'ffmpeg', 'dist', FFMPEG_BUILD_TARGETS['linux-x64'].devFolder);
}

/** The licence texts of the libraries linked into it (tools/ffmpeg/LICENSES/linux-x64, listed in INDEX.txt). */
export function linuxFfmpegLicences(projectDir: string): string {
  return join(projectDir, '..', '..', 'tools', 'ffmpeg', 'LICENSES', 'linux-x64');
}

/** The files of the Linux build that go into resources/ffmpeg, relative to the build folder. */
export const LINUX_FFMPEG_FILES = [
  'bin/ffmpeg',
  'bin/ffprobe',
  'lib/*.so.*',
  'BUILDINFO.json',
  'LICENSE.txt',
];

/**
 * extraResources on Linux: the LGPL FFmpeg as resources/ffmpeg (bin/, lib/, BUILDINFO.json, LICENSE.txt: the
 * layout media's resolver checks against its linux-x64 pin, `resourcesFolder`) and the third-party licences beside
 * it in ffmpeg/LICENSES. Nothing until tools/ffmpeg/build-linux.sh has built it; afterPack then fails the
 * package (linux-ffmpeg.ts), since a package without FFmpeg can't import or export.
 */
export function linuxResources(projectDir: string): FileSet[] {
  const target = FFMPEG_BUILD_TARGETS['linux-x64'];
  const source = linuxFfmpegSource(projectDir);
  if (!existsSync(join(source, 'bin', 'ffmpeg'))) return [];
  const licences = linuxFfmpegLicences(projectDir);
  return [
    { from: source, to: target.resourcesFolder, filter: [...LINUX_FFMPEG_FILES] },
    ...(existsSync(licences) ? [{ from: licences, to: join(target.resourcesFolder, 'LICENSES') }] : []),
  ];
}

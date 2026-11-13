// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFMPEG_BUILD_TARGETS } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import {
  APPARMOR_TEMPLATE,
  DEB_DEPENDS,
  LINUX_TEMPLATES,
  linuxFfmpegSource,
  linuxResources,
} from '../packaging/linux';
import { debMode, linuxAfterPack, normaliseModes } from '../packaging/linux-after-pack';
import { checkPackedFfmpeg, packedFfmpegProblems, resolvePackedFfmpeg } from '../packaging/linux-ffmpeg';

const desktopDir = join(import.meta.dirname, '..');
const release = {
  flavour: 'release',
  updateFeedUrl: undefined,
  updateChannel: undefined,
  crashDsn: undefined,
  telemetryUrl: undefined,
} as const;

/** What electron-builder fills into the templates (FpmTarget's writeConfigFile), failing on any other macro. */
const MACROS = { executable: 'taalcut', sanitizedProductName: 'Taalcut', productFilename: 'Taalcut' };
function render(template: string): string {
  return readFileSync(join(desktopDir, template), 'utf8').replace(/\${([a-zA-Z]+)}/g, (_, name: string) => {
    if (!(name in MACROS)) throw new Error(`${template}: \${${name}} is not an electron-builder macro`);
    return MACROS[name as keyof typeof MACROS];
  });
}

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-linux-pkg-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function writeScript(name: string, text: string): string {
  const file = join(scratch, name);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
  return file;
}

const LINUX_FFMPEG = linuxFfmpegSource(desktopDir);
const LINUX_X64_HOST = process.platform === 'linux' && process.arch === 'x64';
const HAS_LINUX_FFMPEG = existsSync(join(LINUX_FFMPEG, 'bin', 'ffmpeg'));
const HAS_APPARMOR_4 =
  spawnSync('apparmor_parser', ['--version']).status === 0 && existsSync('/etc/apparmor.d/abi/4.0');

describe('the Linux .deb', () => {
  const config = builderConfig({}, desktopDir, release);

  it('is an x64 deb named taalcut in AudioVideo, with no updater feed yet', () => {
    expect(config.linux).toMatchObject({
      target: [{ target: 'deb', arch: ['x64'] }],
      executableName: 'taalcut',
      category: 'AudioVideo;Video;AudioVideoEditing',
      publish: null,
    });
    expect(config.linux?.icon).toBe(
      join(desktopDir, '..', '..', 'design', 'logo', 'kit', 'app-icon', 'linux'),
    );
    expect(config.deb).toMatchObject({
      packageName: 'taalcut',
      recommends: [],
      afterInstall: join(LINUX_TEMPLATES, 'after-install.tpl'),
      afterRemove: join(LINUX_TEMPLATES, 'after-remove.tpl'),
      appArmorProfile: APPARMOR_TEMPLATE,
    });
  });

  it("depends on the keyring, the headless shell's, llama.cpp's and FFmpeg's libraries, by 24.04's names or 22.04's", () => {
    expect(config.deb?.depends).toEqual([...DEB_DEPENDS]);
    expect(DEB_DEPENDS).toEqual(
      expect.arrayContaining([
        'libsecret-1-0',
        'libnss3',
        'libgbm1',
        'libxkbcommon0',
        'libasound2t64 | libasound2',
        'libglib2.0-0t64 | libglib2.0-0',
        'libgomp1',
        'libssl3t64 | libssl3',
        'libvulkan1',
        'libva2',
        'libva-drm2',
        'libc6 (>= 2.35)',
        'bubblewrap',
      ]),
    );
    // A t64 package always has its pre-transition name as the alternative.
    for (const entry of DEB_DEPENDS.filter((dep) => dep.includes('t64')))
      expect(entry).toMatch(/^(\S+)t64 \| \1$/);
  });

  it('packs each platform its own FFmpeg and native pieces', () => {
    const common = (config.extraResources ?? []) as { to?: string }[];
    expect(common.map((set) => set.to)).not.toContain('bin');
    const mac = (config.mac?.extraResources ?? []) as { to?: string; filter?: string[] }[];
    // The mac helper (and, once built, FFmpeg, the CLI, the Seatbelt profiles) only for macOS.
    expect(mac.some((set) => set.filter?.includes('taalcut-mac-helper'))).toBe(true);
    expect(mac.some((set) => set.to?.endsWith('InfoPlist.strings'))).toBe(true);
    const linux = (config.linux?.extraResources ?? []) as { to?: string }[];
    expect(linux.every((set) => set.to?.startsWith('ffmpeg'))).toBe(true);
  });

  it('puts the Linux FFmpeg in resources/ffmpeg once build-linux.sh has built it', () => {
    const project = join(scratch, 'apps', 'desktop');
    expect(linuxResources(project)).toEqual([]);
    const dist = join(scratch, 'tools', 'ffmpeg', 'dist', 'linux-x64');
    mkdirSync(join(dist, 'bin'), { recursive: true });
    writeFileSync(join(dist, 'bin', 'ffmpeg'), '');
    const filter = ['bin/ffmpeg', 'bin/ffprobe', 'lib/*.so.*', 'BUILDINFO.json', 'LICENSE.txt'];
    expect(linuxResources(project)).toEqual([{ from: dist, to: 'ffmpeg', filter }]);
    const licences = join(scratch, 'tools', 'ffmpeg', 'LICENSES', 'linux-x64');
    mkdirSync(licences, { recursive: true });
    expect(linuxResources(project)).toEqual([
      { from: dist, to: 'ffmpeg', filter },
      { from: licences, to: join('ffmpeg', 'LICENSES') },
    ]);
    expect(FFMPEG_BUILD_TARGETS['linux-x64'].resourcesFolder).toBe('ffmpeg');
  });
});

describe('the package scripts', () => {
  it('use only electron-builder macros, and are valid bash', () => {
    for (const name of ['after-install.tpl', 'after-remove.tpl']) {
      const file = writeScript(name.replace('.tpl', '.sh'), render(join(LINUX_TEMPLATES, name)));
      expect(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).stderr).toBe('');
    }
  });

  it('postinst makes chrome-sandbox setuid root on every install, without a condition', () => {
    const postinst = render(join(LINUX_TEMPLATES, 'after-install.tpl'));
    const code = postinst
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).toContain(`chown root:root "$app_dir/chrome-sandbox"\nchmod 4755 "$app_dir/chrome-sandbox"`);
    expect(code).toMatch(/^app_dir='\/opt\/Taalcut'$/m);
    // electron-builder's own script makes it setuid only when root can't unshare, which on 24.04 it always can.
    expect(code).not.toContain('unshare');
    expect(code).not.toMatch(/chmod 0?755 .*chrome-sandbox/);
  });

  it('postinst installs and loads the AppArmor profile when this AppArmor can read it', () => {
    const postinst = render(join(LINUX_TEMPLATES, 'after-install.tpl'));
    expect(postinst).toContain('profile_source="$app_dir/resources/apparmor-profile"');
    expect(postinst).toContain('profile_target="/etc/apparmor.d/$executable"');
    expect(postinst).toContain('apparmor_parser --skip-kernel-load --skip-cache --debug "$profile_source"');
    expect(postinst).toContain('apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"');
  });

  it('postrm takes the command and the profile away on remove and purge only, never on an upgrade', () => {
    const postrm = render(join(LINUX_TEMPLATES, 'after-remove.tpl'));
    expect(postrm).toMatch(/case "\$1" in\n\s+remove \| purge\)/);
    expect(postrm).toContain('apparmor_parser --remove "$profile_target"');
    expect(postrm).toContain('rm -f "$profile_target"');
    // Nothing before the case acts.
    const before = postrm.slice(0, postrm.indexOf('case "$1"'));
    expect(before).not.toMatch(/^\s*(rm|update-alternatives|apparmor_parser)\b/m);
  });
});

describe('the AppArmor profile', () => {
  const profile = () => render(APPARMOR_TEMPLATE);

  it('names the app, the installed headless shell and bubblewrap, unconfined with userns', () => {
    expect(profile()).toContain('profile taalcut /opt/Taalcut/taalcut flags=(unconfined) {\n  userns,');
    expect(profile()).toContain('profile taalcut-bwrap /usr/bin/bwrap flags=(unconfined) {\n  userns,');
    expect(profile()).toContain(
      'profile taalcut-headless-shell /home/*/.config/Taalcut/components/installed/hyperframes-headless-shell/**/chrome-headless-shell flags=(unconfined) {\n  userns,',
    );
    // An attachment can't start with a brace.
    expect(profile()).not.toMatch(/^profile \S+ \{/m);
  });

  it.skipIf(!HAS_APPARMOR_4)('parses with apparmor_parser (needs AppArmor 4)', () => {
    const file = join(scratch, 'taalcut');
    writeFileSync(file, profile());
    const parsed = spawnSync('apparmor_parser', ['--skip-kernel-load', '--skip-cache', '-N', file], {
      encoding: 'utf8',
    });
    expect(parsed.stderr).toBe('');
    expect(parsed.stdout.trim().split('\n')).toEqual(['taalcut', 'taalcut-headless-shell', 'taalcut-bwrap']);
  });
});

describe('checkPackedFfmpeg', () => {
  it('does nothing for macOS', async () => {
    await expect(
      checkPackedFfmpeg({ electronPlatformName: 'darwin', appOutDir: scratch }),
    ).resolves.toBeUndefined();
  });

  it('fails a Linux package without its FFmpeg, and says what to run', async () => {
    await expect(checkPackedFfmpeg({ electronPlatformName: 'linux', appOutDir: scratch })).rejects.toThrow(
      /resources\/ffmpeg\/bin\/ffmpeg is missing[\s\S]*build-linux\.sh/,
    );
  });

  it('fails a build whose BUILDINFO.json is not the pinned one', () => {
    const dir = join(scratch, 'resources', 'ffmpeg');
    const target = FFMPEG_BUILD_TARGETS['linux-x64'];
    for (const path of ['bin/ffmpeg', 'bin/ffprobe', ...target.libraries.map(([, p]) => p), 'LICENSE.txt']) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), '');
    }
    writeFileSync(join(dir, 'BUILDINFO.json'), '{}');
    expect(packedFfmpegProblems(dir)).toEqual([
      expect.stringMatching(/BUILDINFO\.json is \w+, not the pinned/),
    ]);
  });

  it.skipIf(!LINUX_X64_HOST || !HAS_LINUX_FFMPEG)(
    'accepts the built FFmpeg, LGPL, through the resolver the app runs (needs linux-x64 and build-linux.sh)',
    async () => {
      const dir = join(scratch, 'resources', 'ffmpeg');
      mkdirSync(join(scratch, 'resources'), { recursive: true });
      execFileSync('cp', ['-r', LINUX_FFMPEG, dir]);
      expect(packedFfmpegProblems(dir)).toEqual([]);
      const resolved = await resolvePackedFfmpeg(dir);
      expect(resolved).toMatchObject({
        verified: true,
        ffmpegInfo: { licence: expect.stringMatching(/^LGPL/) },
      });
      const logs: string[] = [];
      await checkPackedFfmpeg(
        { electronPlatformName: 'linux', appOutDir: scratch },
        { log: (line) => logs.push(line) },
      );
      expect(logs).toEqual([expect.stringContaining('verified against the pin')]);
    },
  );
});

describe('linuxAfterPack', () => {
  it('gives folders and executables 0755 and every other file, shared libraries too, 0644', () => {
    expect(debMode('lib', 0o40775, true)).toBe(0o755);
    expect(debMode('taalcut', 0o100775, false)).toBe(0o755);
    expect(debMode('icudtl.dat', 0o100664, false)).toBe(0o644);
    expect(debMode('libavcodec.so.63', 0o100755, false)).toBe(0o644);
    expect(debMode('libffmpeg.so', 0o100755, false)).toBe(0o644);
    expect(debMode('chrome-sandbox', 0o100755, false)).toBe(0o755);
  });

  it('normalises a tree whatever the umask left, and leaves links alone', () => {
    const app = join(scratch, 'linux-unpacked');
    mkdirSync(join(app, 'resources', 'ffmpeg', 'lib'), { recursive: true });
    chmodSync(join(app, 'resources'), 0o775);
    writeScript('linux-unpacked/taalcut', '');
    chmodSync(join(app, 'taalcut'), 0o775);
    writeFileSync(join(app, 'resources', 'app.asar'), '');
    chmodSync(join(app, 'resources', 'app.asar'), 0o664);
    writeFileSync(join(app, 'resources', 'ffmpeg', 'lib', 'libavutil.so.61'), '');
    chmodSync(join(app, 'resources', 'ffmpeg', 'lib', 'libavutil.so.61'), 0o755);
    symlinkSync('libavutil.so.61', join(app, 'resources', 'ffmpeg', 'lib', 'libavutil.so'));
    // At least these four, and the folders mkdir made under this umask.
    expect(normaliseModes(app)).toBeGreaterThanOrEqual(4);
    const mode = (path: string) => statSync(join(app, path)).mode & 0o7777;
    expect([mode('resources'), mode('taalcut'), mode('resources/app.asar')]).toEqual([0o755, 0o755, 0o644]);
    expect(mode('resources/ffmpeg/lib/libavutil.so.61')).toBe(0o644);
    expect(normaliseModes(app)).toBe(0);
  });

  it('does nothing for macOS', async () => {
    const logs: string[] = [];
    await linuxAfterPack({ electronPlatformName: 'darwin', appOutDir: scratch }, (line) => logs.push(line));
    expect(logs).toEqual([]);
  });
});

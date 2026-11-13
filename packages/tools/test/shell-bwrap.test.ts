// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Linux backend (AGT2 sbx) without a Linux machine: bwrap's options, the host probe and its messages, the
 * seccomp program run through an interpreter of its own bytes, and dash's ulimit flag in the wrapper.
 */
import { describe, expect, it } from 'vitest';
import { SHELL_WRAPPER } from '../src/shell/backend';
import { bwrapArgs, bwrapHasDisableUserns, bwrapUnavailableDetail, type BwrapHost } from '../src/shell/bwrap';
import { bwrapBackendFor, probeBwrapHost } from '../src/shell/bwrap-host';
import { SECCOMP_DENIED, seccompVerdict, shellSeccompFilter } from '../src/shell/seccomp';

const merged: BwrapHost = {
  root: (name) => (name === 'libx32' || name === 'lib32' ? null : { link: `usr/${name}` }),
  disableUserns: true,
  seccomp: true,
};
const FOLDER = '/home/u/.config/Taalcut/shell/P';

describe('bwrap options', () => {
  it('unshares everything, binds /usr and the toolchain read-only, the folder read-write but inputs and manifest', () => {
    const args = bwrapArgs(FOLDER, ['/opt/Taalcut/resources/ffmpeg'], merged);
    const joined = args.join(' ');
    expect(args.slice(0, 7)).toEqual([
      '--unshare-all',
      '--unshare-user',
      '--die-with-parent',
      '--new-session',
      '--cap-drop',
      'ALL',
      '--disable-userns',
    ]);
    expect(joined).toContain('--ro-bind /usr /usr');
    expect(joined).toContain('--symlink usr/bin /bin');
    expect(joined).not.toContain('/lib32');
    expect(joined).toContain('--ro-bind /opt/Taalcut/resources/ffmpeg /opt/Taalcut/resources/ffmpeg');
    expect(joined).toContain(`--bind ${FOLDER} ${FOLDER} --ro-bind ${FOLDER}/inputs ${FOLDER}/inputs`);
    expect(joined).toContain(`--ro-bind ${FOLDER}/shell.json ${FOLDER}/shell.json`);
    expect(joined).toContain(`--chdir ${FOLDER}/work`);
    expect(args.slice(-2)).toEqual(['--seccomp', '3']);
    // Nothing of the home folder but the shell folder, and no host /run, /sys or /var.
    expect(
      args.filter((arg) => /^\/(home|run|sys|var)\b/.test(arg)).every((arg) => arg.startsWith(FOLDER)),
    ).toBe(true);
    expect(joined).not.toContain('--share-net');
  });

  it('leaves out what an older bwrap or another architecture lacks', () => {
    const args = bwrapArgs(FOLDER, [], { ...merged, disableUserns: false, seccomp: false });
    expect(args).not.toContain('--disable-userns');
    expect(args).not.toContain('--seccomp');
    expect(bwrapHasDisableUserns('bubblewrap 0.9.0')).toBe(true);
    expect(bwrapHasDisableUserns('bubblewrap 0.6.1')).toBe(false);
  });
});

describe('the host probe', () => {
  const calls: string[][] = [];
  const run = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === '--version') return { stdout: 'bubblewrap 0.9.0\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };

  it('finds the version, the merged-/usr links and a trial run, once', async () => {
    const backendFor = bwrapBackendFor({
      run,
      arch: 'x64',
      executable: async () => true,
      root: async (name) => (name === 'bin' ? { link: 'usr/bin' } : null),
    });
    const toolchain = { roots: [], bin: [], env: {}, programs: [] };
    const first = await backendFor(FOLDER, toolchain, [1, 2, 3, 4]);
    await backendFor(FOLDER, toolchain, [1, 2, 3, 4]);
    expect(first.ok && first.value.fileBlockBytes).toBe(512);
    expect(
      first.ok && first.value.backend.kind === 'bwrap' && first.value.backend.seccomp?.length,
    ).toBeGreaterThan(0);
    expect(calls.filter((args) => args[0] === '--version')).toHaveLength(1);
    expect(calls.find((args) => args.includes('/usr/bin/true'))).toEqual(
      expect.arrayContaining(['--unshare-all', '--symlink', 'usr/bin', '/bin']),
    );
  });

  it('is sandbox.unavailable with what to do: install bubblewrap, or load the AppArmor profile', async () => {
    const missing = await probeBwrapHost({ executable: async () => false });
    expect(!missing.ok && missing.error.code).toBe('sandbox.unavailable');
    expect(!missing.ok && missing.error.detail).toMatch(/sudo apt install bubblewrap/);
    const refused = await probeBwrapHost({
      executable: async () => true,
      root: async () => null,
      run: async (_file, args) => {
        if (args[0] === '--version') return { stdout: 'bubblewrap 0.9.0', stderr: '' };
        throw Object.assign(new Error('exit 1'), {
          stderr: 'bwrap: setting up uid map: Permission denied\n',
        });
      },
    });
    expect(!refused.ok && refused.error.detail).toMatch(/AppArmor profile/);
    expect(bwrapUnavailableDetail({ stderr: 'bwrap: something else' })).toMatch(/bwrap: something else/);
  });
});

describe('the seccomp filter', () => {
  const filter = shellSeccompFilter();

  it('allows ordinary calls, and inet sockets (the shell has a loopback of its own)', () => {
    for (const nr of [0, 1, 2, 3, 9, 41, 42, 49, 50, 57, 59, 60, 231])
      expect(seccompVerdict(filter, { nr })).toBe('allow');
    expect(seccompVerdict(filter, { nr: 56, args: [0x11] })).toBe('allow');
    expect(seccompVerdict(filter, { nr: 16, args: [1, 0x5401] })).toBe('allow');
  });

  it('refuses io_uring, keyrings, eBPF, mounts and the rest, a new user namespace and TIOCSTI', () => {
    for (const nr of Object.values(SECCOMP_DENIED)) expect(seccompVerdict(filter, { nr })).toBe('eperm');
    expect(seccompVerdict(filter, { nr: 56, args: [0x10000000 | 0x11] })).toBe('eperm');
    expect(seccompVerdict(filter, { nr: 272, args: [0x10000000] })).toBe('eperm');
    expect(seccompVerdict(filter, { nr: 272, args: [0x00020000] })).toBe('allow');
    expect(seccompVerdict(filter, { nr: 16, args: [0, 0x5412] })).toBe('eperm');
    expect(seccompVerdict(filter, { nr: 435 })).toBe('enosys');
  });

  it('kills another architecture and the x32 ABI', () => {
    expect(seccompVerdict(filter, { arch: 0x40000003, nr: 1 })).toBe('kill');
    expect(seccompVerdict(filter, { nr: 0x40000000 | 1 })).toBe('kill');
  });
});

describe('the wrapper', () => {
  it("sets the process limit with bash's -u, else dash's -p", () => {
    expect(SHELL_WRAPPER).toContain('{ ulimit -u "$4" 2>/dev/null || ulimit -p "$4" 2>/dev/null || :; }');
  });
});

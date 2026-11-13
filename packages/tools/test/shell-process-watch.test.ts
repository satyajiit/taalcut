// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The shell's process watch and output capture, pure: ps rows in, the tree and its memory out (AGT2 sbx). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confinedArgv, wrapperArgv } from '../src/shell/backend';
import { headAndTail, tailOnly } from '../src/shell/output';
import { parsePs, trackTree, type ProcessRow } from '../src/shell/process-watch';

afterEach(() => vi.restoreAllMocks());

const row = (
  pid: number,
  ppid: number,
  pgid: number,
  rssKiB = 1024,
  started = `Mon Nov  3 10:00:0${pid % 10} 2026`,
) => ({ pid, ppid, pgid, rssKiB, started }) satisfies ProcessRow;

describe('parsePs', () => {
  it('reads pid, ppid, pgid, rss and the start time, and skips what it cannot read', () => {
    const rows = parsePs(
      ' 51299 51297 51297   1184 Tue Nov  3 22:03:24 2026    \nnoise\n 7 1 7 0 Mon Nov  3 10:00:00 2026',
    );
    expect(rows).toEqual([
      { pid: 51299, ppid: 51297, pgid: 51297, rssKiB: 1184, started: 'Tue Nov  3 22:03:24 2026' },
      { pid: 7, ppid: 1, pgid: 7, rssKiB: 0, started: 'Mon Nov  3 10:00:00 2026' },
    ]);
  });
});

describe('trackTree', () => {
  it('sums the root, its group and its descendants, and nothing else', async () => {
    const rows = [
      row(100, 1, 100),
      row(101, 100, 100),
      row(102, 101, 102),
      row(103, 102, 103),
      row(200, 1, 200),
    ];
    const tree = trackTree(100, async () => rows);
    expect(await tree.poll()).toEqual({ rssBytes: 4 * 1024 * 1024, processes: 4 });
  });

  it('keeps a process it saw once it leaves the group and is orphaned, but not a pid reused by another', async () => {
    let rows = [row(100, 1, 100), row(101, 100, 100)];
    const tree = trackTree(100, async () => rows);
    await tree.poll();
    // 101 calls setsid and its parent exits: it is reparented to launchd in a group of its own.
    rows = [row(101, 1, 101)];
    expect((await tree.poll()).processes).toBe(1);
    // The pid comes back as someone else's process (another start time).
    rows = [{ ...row(101, 1, 101), started: 'Tue Nov  4 09:00:00 2026' }];
    expect((await tree.poll()).processes).toBe(0);
    expect(await tree.alive()).toEqual([]);
  });

  it('signals an observed child that detaches between polls, without signalling reused or unrelated pids', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    let rows = [row(100, 1, 100), row(101, 100, 100), row(102, 100, 100)];
    const tree = trackTree(100, async () => rows);
    await tree.poll();
    // The shell exits before another poll sees that 101 called setsid; 102 now belongs to someone else.
    rows = [row(101, 1, 101), row(102, 1, 102, 1024, 'Tue Nov  4 09:00:00 2026'), row(200, 1, 200)];
    expect(await tree.signal('SIGKILL')).toBe(3);
    expect(kill.mock.calls).toEqual([
      [100, 'SIGKILL'],
      [-100, 'SIGKILL'],
      [101, 'SIGKILL'],
    ]);
  });
});

describe('the wrapper', () => {
  it('passes limits as arguments and never interpolates the command', () => {
    const confined = confinedArgv(
      {
        kind: 'seatbelt',
        sandboxExec: '/usr/bin/sandbox-exec',
        profile: '/p/workspace.sb',
        params: [['WS', '/w']],
      },
      'echo "$HOME"; rm -rf /',
    );
    expect(confined).toEqual([
      '/usr/bin/sandbox-exec',
      '-f',
      '/p/workspace.sb',
      '-D',
      'WS=/w',
      '/bin/sh',
      '-c',
      'echo "$HOME"; rm -rf /',
    ]);
    const argv = wrapperArgv(
      {
        cpuSeconds: 7200,
        maxFileBytes: 4 * 1024 ** 3,
        openFiles: 4096,
        processCap: 1100,
        fileBlockBytes: 1024,
      },
      confined,
    );
    expect(argv.slice(2, 7)).toEqual(['shell', '7200', String(4 * 1024 ** 2), '4096', '1100']);
    expect(argv.at(-1)).toBe('echo "$HOME"; rm -rf /');
    expect(
      confinedArgv({ kind: 'bwrap', bwrap: '/usr/bin/bwrap', args: ['--unshare-all'] }, 'ls').slice(0, 4),
    ).toEqual(['/usr/bin/bwrap', '--unshare-all', '--', '/bin/sh']);
  });
});

describe('output capture', () => {
  it('keeps the head and tail within its limit, on character boundaries', () => {
    const kept = headAndTail(30);
    kept.push(Buffer.from('é'.repeat(50)));
    const text = kept.text();
    expect(text).toMatch(/^(é)+\n\[… \d+ bytes cut …\]\n(é)+$/);
    expect(kept.total).toBe(100);
    const short = headAndTail(30);
    short.push(Buffer.from('hello'));
    expect(short.text()).toBe('hello');
  });

  it('keeps only the tail of stderr', () => {
    const kept = tailOnly(8);
    kept.push(Buffer.from('0123456789abcdef'));
    expect(kept.text()).toBe('[… 8 bytes cut …]\n89abcdef');
  });
});

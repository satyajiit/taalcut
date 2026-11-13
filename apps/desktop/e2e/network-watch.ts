// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "No outbound traffic" as a measurement, not a promise: while it runs, every
 * second it lists the sockets of the app's whole process tree (main, its
 * helpers, the utility processes and their children such as FFmpeg and
 * whisper-cli) with `lsof -i`, and keeps any whose remote end is not this Mac.
 * Listening sockets and loopback (the renderer's dev server, the media
 * protocol, Electron's own IPC) are fine; anything else is a leak.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Connection {
  readonly pid: number;
  readonly command: string;
  readonly protocol: string;
  readonly name: string;
  /** For a leak: which process it was (Electron's helpers differ only by their flags) and when, in ms. */
  readonly process?: string;
  readonly afterMs?: number;
}

/** The process's role: Electron's --type and sub-type flags, or its first words. */
async function describeProcess(pid: number): Promise<string> {
  const { stdout } = await run('/bin/ps', ['-o', 'args=', '-p', String(pid)]).catch(() => ({ stdout: '' }));
  const flags = stdout.match(/--(type|utility-sub-type|service-sandbox-type)=\S+/g);
  return flags ? flags.join(' ') : stdout.trim().slice(0, 160);
}

/** Every process under `root`, root included. */
async function tree(root: number): Promise<number[]> {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=']);
  const children = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (!match) continue;
    const [pid, ppid] = [Number(match[1]), Number(match[2])];
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const all: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    all.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return all;
}

const LOCAL = /^(127\.\d+\.\d+\.\d+|\[::1\]|localhost|\*)(:\d+|:\*)?$/;

/** A socket whose far end is not this Mac (`lsof -nP -i -F`), or undefined. */
function outbound(protocol: string, name: string): boolean {
  if (/\(LISTEN\)/.test(name)) return false;
  const remote = name.split('->')[1]?.replace(/\s*\(.*\)$/, '');
  if (remote === undefined) {
    // A bound UDP socket without a peer: outbound only if it is bound to a non-local address.
    const local = name.replace(/\s*\(.*\)$/, '');
    return protocol === 'UDP' && !LOCAL.test(local);
  }
  return !LOCAL.test(remote);
}

async function sockets(pids: readonly number[]): Promise<Connection[]> {
  if (pids.length === 0) return [];
  // lsof exits 1 when it finds nothing; that is the answer, not an error.
  const result = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', pids.join(','), '-i', '-F', 'pcPn']).catch(
    (error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }),
  );
  const found: Connection[] = [];
  let pid = 0;
  let command = '';
  let protocol = '';
  for (const line of result.stdout.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') pid = Number(value);
    else if (field === 'c') command = value;
    else if (field === 'P') protocol = value;
    else if (field === 'n') found.push({ pid, command, protocol, name: value });
  }
  return found;
}

export interface NetworkWatch {
  /** Outbound sockets seen so far (deduplicated by process and address). */
  readonly leaks: () => readonly Connection[];
  /** How many times the tree was checked. */
  readonly checks: () => number;
  stop(): Promise<void>;
}

export function watchNetwork(rootPid: number, intervalMs = 1000): NetworkWatch {
  const seen = new Map<string, Connection>();
  const started = Date.now();
  let count = 0;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        for (const socket of await sockets(await tree(rootPid))) {
          const key = `${socket.command}|${socket.name}`;
          if (!outbound(socket.protocol, socket.name) || seen.has(key)) continue;
          seen.set(key, {
            ...socket,
            process: await describeProcess(socket.pid),
            afterMs: Date.now() - started,
          });
        }
        count += 1;
      } catch {
        // A process that exited between ps and lsof: the next round sees the tree again.
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  return {
    leaks: () => [...seen.values()],
    checks: () => count,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}

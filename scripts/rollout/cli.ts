// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `node scripts/release.mjs <publish|promote|pull|resign> …` for the release workflows (and the packaged update
 * e2e, with --dir). `--repo owner/name` works on GitHub Releases through `gh`; `--dir <folder>` on a folder laid
 * out like GitHub's download URLs (release-store.ts). Nothing is published unless one of them is given. Every
 * channel file written is signed with TAALCUT_UPDATE_SIGNING_KEY (key-commands.ts, SB-19).
 */
import {
  keygen,
  resignChannel,
  signingKeyFrom,
  signLocalFile,
  testKeyPem,
  type Env,
} from './key-commands.ts';
import { publishRelease } from './publish.ts';
import { dirReleaseStore, ghReleaseStore, type ReleaseStore } from './release-store.ts';
import { promoteRelease, pullRelease } from './rollout.ts';
import { signingStore } from './signing-store.ts';
import { isPublicChannel, type PublicChannel } from './versions.ts';

const USAGE = `Usage: node scripts/release.mjs <command> (--repo <owner/name> | --dir <folder>) [options]

  publish  --channel <stable|beta> --version <v> --artifacts <dir> --notes <dir> [--stage 10]
           --download-base <url> --repo-url <https://github.com/owner/name>
           --commit <build run SHA> (required with --repo)
  promote  --channel <stable|beta> --version <v> --stage <50|100>
  pull     --channel <stable|beta> --bad-version <v> --to-version <v> --reason <text>
  resign   --channel <stable|beta>
Each needs TAALCUT_UPDATE_SIGNING_KEY. Without --repo or --dir:
  keygen   --out <new file>          a signing key pair (prints the public key)
  sign     --file <channel>-mac.yml  signs a local channel file
  test-key                           prints the e2e test key (test builds only)
`;
const STORE_COMMANDS = new Set(['publish', 'promote', 'pull', 'resign']);

export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

function options(args: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`expected --option value pairs, got ${key ?? ''}`);
    }
    found.set(key.slice(2), value);
  }
  return found;
}

function required(found: Map<string, string>, key: string): string {
  const value = found.get(key)?.trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function channelOf(found: Map<string, string>): PublicChannel {
  const channel = required(found, 'channel');
  if (!isPublicChannel(channel)) throw new Error(`--channel must be stable or beta, got ${channel}`);
  return channel;
}

function stageOf(found: Map<string, string>, fallback?: number): number {
  const text = found.get('stage') ?? (fallback === undefined ? undefined : String(fallback));
  const stage = Number(text);
  if (!Number.isInteger(stage)) throw new Error('--stage must be a whole percentage');
  return stage;
}

/** The store, wrapped so every channel file it uploads is signed. */
function storeOf(found: Map<string, string>, env: Env, now: () => Date, commit?: string): ReleaseStore {
  const repo = found.get('repo');
  const dir = found.get('dir');
  if ((repo === undefined) === (dir === undefined)) throw new Error('give exactly one of --repo and --dir');
  const key = signingKeyFrom(env, repo ? 'repo' : 'dir');
  return signingStore(repo ? ghReleaseStore(repo, undefined, commit) : dirReleaseStore(dir ?? ''), key, now);
}

/** keygen, sign and test-key: no release store. */
function keyCommand(command: string, found: Map<string, string>, env: Env, now: () => Date): string[] {
  if (command === 'keygen') {
    return [`public key (TAALCUT_UPDATE_PUBLIC_KEY): ${keygen(required(found, 'out'))}`];
  }
  if (command === 'sign') return [`signed: ${signLocalFile(required(found, 'file'), env, now)}`];
  return [testKeyPem().trimEnd()];
}

export async function run(
  argv: readonly string[],
  io: Io,
  env: Env = process.env,
  now: () => Date = () => new Date(),
): Promise<number> {
  const [command, ...rest] = argv;
  if (
    command === undefined ||
    (!STORE_COMMANDS.has(command) && !['keygen', 'sign', 'test-key'].includes(command))
  ) {
    io.stderr(USAGE);
    return 2;
  }
  try {
    const found = options(rest);
    if (!STORE_COMMANDS.has(command)) {
      for (const line of keyCommand(command, found, env, now)) io.stdout(`${line}\n`);
      return 0;
    }
    const commit = command === 'publish' && found.has('repo') ? required(found, 'commit') : undefined;
    const store = storeOf(found, env, now, commit);
    let written: string[];
    if (command === 'resign') {
      written = await resignChannel(store, channelOf(found));
    } else if (command === 'publish') {
      written = await publishRelease(store, {
        channel: channelOf(found),
        version: required(found, 'version'),
        artifacts: required(found, 'artifacts'),
        requireSource: found.has('repo'),
        notes: required(found, 'notes'),
        stage: stageOf(found, 10),
        downloadBase: required(found, 'download-base'),
        repoUrl: required(found, 'repo-url'),
        now,
      });
    } else if (command === 'promote') {
      written = await promoteRelease(store, {
        channel: channelOf(found),
        version: required(found, 'version'),
        stage: stageOf(found),
      });
    } else {
      written = await pullRelease(store, {
        channel: channelOf(found),
        badVersion: required(found, 'bad-version'),
        toVersion: required(found, 'to-version'),
        reason: required(found, 'reason'),
      });
    }
    for (const line of written) io.stdout(`${line}\n`);
    return 0;
  } catch (cause) {
    io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
}

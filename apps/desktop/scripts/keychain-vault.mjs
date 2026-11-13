// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The keychain vault (src/main/composition/secret-store.ts) in Electron against a real keychain, never the
 * person's and never the mock one. It makes a throwaway keychain with a random password, unlocked and without
 * auto-lock, as the only keychain of a temporary HOME, and runs test/keychain/vault-probe.ts there, one process
 * per phase:
 *
 *   write, read     the vault's round trip; the async API reads what the sync API wrote, and the other way round,
 *                   within one process and from a new one (so safeStorage fetches its key from the keychain again)
 *   reencrypt, read the vault re-encrypting a value when decryptStringAsync asks, then a new process reading it
 *   locked          (--locked) a vault read with the keychain locked: macOS asks for its password, the read waits
 *                   while main keeps ticking, and answers once the prompt is answered. This puts a system prompt
 *                   on screen, so it is not part of test:scripts. With Accessibility access for the terminal the
 *                   script answers the prompt itself (scripts/keychain-prompt.swift, only a prompt naming this
 *                   keychain); without it, it prints the password for you to type.
 *
 * Afterwards it deletes the keychain and the temporary HOME, and checks the person's default keychain and search
 * list are what they were. macOS only.
 *
 *   node scripts/keychain-vault.mjs [--locked]
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(DESKTOP, 'test', 'keychain', 'vault-probe.ts');
const PROMPT_SOURCE = join(DESKTOP, 'scripts', 'keychain-prompt.swift');
const ITEM = 'TaalcutVaultProof Safe Storage';
const PHASE_TIMEOUT_MS = 60_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function security(home, args, input) {
  return execFileSync('security', args, {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** The person's keychain settings: default, search list, and their preferences file. Reading asks nothing. */
function personsKeychains() {
  const home = process.env.HOME ?? '';
  const read = (args) => {
    try {
      return security(home, args).trim();
    } catch (error) {
      return `(${error.stderr?.toString().trim() || error.message})`;
    }
  };
  const plist = join(home, 'Library', 'Preferences', 'com.apple.security.plist');
  const prefs = existsSync(plist) ? createHash('sha256').update(readFileSync(plist)).digest('hex') : 'none';
  return `default ${read(['default-keychain'])}; list ${read(['list-keychains'])}; prefs ${prefs}`;
}

/** The throwaway keychain: the only one in a new HOME's search list, its default, unlocked, no auto-lock. */
function makeKeychain(root) {
  const home = join(root, 'home');
  mkdirSync(join(home, 'Library', 'Preferences'), { recursive: true });
  mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true });
  const name = `taalcut-vault-proof-${randomBytes(3).toString('hex')}`;
  const keychain = join(home, 'Library', 'Keychains', `${name}.keychain-db`);
  const password = randomBytes(18).toString('base64url');
  security(home, ['create-keychain', '-p', password, keychain]);
  security(home, ['list-keychains', '-d', 'user', '-s', keychain]);
  security(home, ['default-keychain', '-d', 'user', '-s', keychain]);
  security(home, ['set-keychain-settings', keychain]);
  security(home, ['unlock-keychain', '-p', password, keychain]);
  const chosen = security(home, ['default-keychain']).trim();
  if (!chosen.includes(keychain)) throw new Error(`the temporary HOME's default keychain is ${chosen}`);
  return { home, keychain, name, password };
}

async function bundleProbe(root) {
  const { rolldown } = await import('rolldown');
  const file = join(root, 'probe', 'main.cjs');
  const bundle = await rolldown({
    input: PROBE,
    platform: 'node',
    external: ['electron'],
    logLevel: 'silent',
  });
  await bundle.write({ file, format: 'cjs' });
  await bundle.close();
  return file;
}

/** One probe process; resolves with its JSON lines once it exits. `onLine` sees each line as it comes. */
function startPhase(ctx, phase, onLine = () => {}) {
  const env = { ...process.env, HOME: ctx.home };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    ctx.electron,
    [
      ctx.probe,
      `--user-data-dir=${join(ctx.root, `user-data-${phase}`)}`,
      `--phase=${phase}`,
      `--vault=${ctx.vault}`,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  ctx.children.add(child);
  const lines = [];
  let stderr = '';
  let buffered = '';
  child.stdout.setEncoding('utf8').on('data', (text) => {
    buffered += text;
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const raw = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (!raw.startsWith('{')) continue;
      const line = JSON.parse(raw);
      lines.push(line);
      onLine(line);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`${phase}: no answer in ${PHASE_TIMEOUT_MS / 1000} s (last step: ${lines.at(-1)?.step})`),
      );
    }, PHASE_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      ctx.children.delete(child);
      if (code === 0) resolve(lines);
      else
        reject(
          new Error(`${phase}: exit ${code}, ${lines.at(-1)?.message ?? stderr.trim().split('\n').at(-1)}`),
        );
    });
  });
  return { child, lines, done };
}

function stepOf(lines, phase, step) {
  const line = lines.find((each) => each.step === step);
  if (!line) throw new Error(`${phase}: no "${step}" step`);
  return line;
}

/** The four reads write and read report; each must be the value as written. */
function checkReads(check, phase, lines) {
  for (const step of ['vault reads its own', 'vault reads the sync API’s']) {
    const line = stepOf(lines, phase, step);
    check(`${phase}: ${step}`, line.ok === true && line.reads === true, line.error);
  }
  for (const step of ['both APIs read the vault’s', 'both APIs read the sync API’s']) {
    const line = stepOf(lines, phase, step);
    check(`${phase}: ${step}`, line.asyncReads === true && line.syncReads === true, JSON.stringify(line));
  }
}

function promptTool(ctx) {
  const tool = join(ctx.root, 'keychain-prompt');
  execFileSync('swiftc', ['-O', '-o', tool, PROMPT_SOURCE], { stdio: ['ignore', 'ignore', 'pipe'] });
  const run = (args, input) => execFileSync(tool, args, { encoding: 'utf8', input }).trim();
  return { trusted: run(['trusted']) === 'true', run };
}

async function lockedPhase(ctx, check, facts, say) {
  const prompt = promptTool(ctx);
  ctx.prompt = prompt;
  security(ctx.home, ['lock-keychain', ctx.keychain]);
  const phase = startPhase(ctx, 'locked');
  const answered = () => phase.lines.some((line) => line.step === 'answered');
  let shownAt;
  const started = Date.now();
  while (Date.now() - started < 15_000 && !shownAt) {
    if (prompt.run(['list', ctx.name])) shownAt = Date.now() - started;
    else await delay(200);
  }
  check('locked: macOS asks for the keychain’s password', shownAt !== undefined, 'no prompt in 15 s');
  check('locked: the read waits for the answer', !answered(), 'it answered before the prompt was');
  // The keychain unlocked from the command line: the prompt stays, and the read waits for it.
  security(ctx.home, ['unlock-keychain', '-p', ctx.password, ctx.keychain]);
  await delay(3000);
  facts.answeredAfterCommandLineUnlock = answered();
  facts.promptAfterCommandLineUnlock = prompt.run(['list', ctx.name]) !== '';
  if (prompt.trusted) {
    facts.promptAnswered = prompt.run(['answer', ctx.name], `${ctx.password}\n`);
  } else {
    say(`macOS asks for the password of the keychain “${ctx.name}”: type ${ctx.password}`);
  }
  const lines = await phase.done;
  const result = stepOf(lines, 'locked', 'answered');
  const waits = lines.filter((line) => line.step === 'waiting').length;
  check(
    'locked: the read answers with the value once the prompt is answered',
    result.reads === true,
    result.error,
  );
  check(`locked: main ticked throughout (${waits} waiting reports)`, waits >= 6, `${waits} reports`);
  check(
    `locked: main's longest gap was ${result.maxGapMs} ms`,
    result.maxGapMs < 500,
    `${result.maxGapMs} ms`,
  );
  facts.lockedAnsweredAfterMs = result.afterMs;
  facts.lockedMaxGapMs = result.maxGapMs;
  check('locked: no prompt left on screen', prompt.run(['list', ctx.name]) === '', 'a prompt is still up');
}

/** Runs every phase; returns the checks (name, ok, why not) and what was measured. Cleans up whatever happens. */
export async function proveVault({ locked = false, say = () => {} } = {}) {
  if (process.platform !== 'darwin') throw new Error('the keychain vault proof runs on macOS only');
  const before = personsKeychains();
  const root = mkdtempSync(join(tmpdir(), 'taalcut-vault-proof-'));
  const checks = [];
  const facts = {};
  const check = (name, ok, why) => {
    checks.push({ name, ok, ...(ok ? {} : { why: why ?? 'failed' }) });
    say(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${why ?? 'failed'}`}`);
  };
  const ctx = { root, children: new Set(), electron: createRequire(import.meta.url)('electron') };
  try {
    Object.assign(ctx, makeKeychain(root), {
      vault: join(root, 'vault.json'),
      probe: await bundleProbe(root),
    });
    check('the person’s keychain settings are untouched by the throwaway one', personsKeychains() === before);
    const write = await startPhase(ctx, 'write').done;
    const available = stepOf(write, 'write', 'available');
    check('write: safeStorage is available (async and sync)', available.async && available.sync);
    check('write: the vault sets a value', stepOf(write, 'write', 'set').ok === true);
    checkReads(check, 'write', write);
    facts.shouldReEncrypt = {
      vaults: stepOf(write, 'write', 'both APIs read the vault’s').shouldReEncrypt,
      syncApis: stepOf(write, 'write', 'both APIs read the sync API’s').shouldReEncrypt,
    };
    let found = true;
    try {
      security(ctx.home, ['find-generic-password', '-s', ITEM, ctx.keychain]);
    } catch {
      found = false;
    }
    check('the key is an item in the throwaway keychain', found, `no "${ITEM}" item there`);
    checkReads(check, 'read', await startPhase(ctx, 'read').done);
    const again = await startPhase(ctx, 'reencrypt').done;
    const asked = stepOf(again, 'reencrypt', 'vault reads, asked to re-encrypt');
    check(
      'reencrypt: the vault reads the value it is asked to re-encrypt',
      asked.ok && asked.reads,
      asked.error,
    );
    const rewritten = stepOf(again, 'reencrypt', 're-encrypted');
    check(
      'reencrypt: it encrypts once more, and both APIs read the result',
      rewritten.encrypts === 1 && rewritten.asyncReads && rewritten.syncReads,
      JSON.stringify(rewritten),
    );
    facts.reEncryptedSameBytes = rewritten.sameBytes;
    checkReads(check, 'read after re-encryption', await startPhase(ctx, 'read').done);
    if (locked) await lockedPhase(ctx, check, facts, say);
  } finally {
    for (const child of ctx.children) child.kill('SIGKILL');
    if (ctx.prompt?.trusted && ctx.name && ctx.prompt.run(['list', ctx.name]) !== '') {
      check('cleanup: no prompt left to cancel', false, ctx.prompt.run(['cancel', ctx.name]));
    }
    if (locked && ctx.prompt && !ctx.prompt.trusted)
      say(`If a prompt for “${ctx.name}” is still up, press Cancel.`);
    if (ctx.keychain) {
      let deleted = true;
      try {
        security(ctx.home, ['delete-keychain', ctx.keychain]);
      } catch (error) {
        deleted = false;
        check('cleanup: the throwaway keychain is deleted', false, error.stderr?.toString().trim());
      }
      if (deleted)
        check('cleanup: the throwaway keychain is deleted', !existsSync(ctx.keychain), ctx.keychain);
    }
    rmSync(root, { recursive: true, force: true });
    check('afterwards the person’s keychain settings are as they were', personsKeychains() === before);
  }
  return { checks, facts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const say = (line) => process.stdout.write(`${line}\n`);
  try {
    const { checks, facts } = await proveVault({ locked: process.argv.includes('--locked'), say });
    say(`facts: ${JSON.stringify(facts)}`);
    const failed = checks.filter((each) => !each.ok).length;
    say(failed === 0 ? `keychain vault: ${checks.length} checks passed` : `keychain vault: ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (error) {
    console.error(`keychain vault: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

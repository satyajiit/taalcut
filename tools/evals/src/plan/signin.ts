// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The evals' own ChatGPT sign-in and sign-out (HFW1 dsn; the commands are signin-cli.ts). It runs @taalcut/models'
 * own sign-in (the auth broker's signIn('openai')) over the eval's sign-in file (credentials-file.ts). It prints the
 * sign-in page's address (and opens it on macOS) and, where a flow uses one, the device code; every line goes
 * through the broker's scrub, so no token is ever printed.
 */
import { spawn } from 'node:child_process';
import type { SignInEvent } from '@taalcut/models';
import { deleteEvalCredentials, evalCredentialsPath } from './credentials-file';
import { openPlan, PLAN_PROVIDER, PLANS, type PlanOptions } from './chatgpt';

export interface SignInIo {
  /** One line out (already scrubbed). */
  readonly say: (line: string) => void;
  /** Opens the sign-in page; default: macOS `open`, else nothing (the address is printed either way). */
  readonly openBrowser?: (url: string) => void | Promise<void>;
}

function macOpen(url: string): void {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
}

/** Signs in to the plan; resolves with the account's label, or throws with a scrubbed reason. */
export async function signIn(plan: string, io: SignInIo, options: Omit<PlanOptions, 'openExternal' | 'onSignInEvent'> = {}) {
  if (!PLANS.includes(plan as (typeof PLANS)[number])) throw new Error(`No plan "${plan}": sign in to ${PLANS.join(', ')}`);
  // The broker's scrub knows the tokens only once it has handled them, so every line goes through it as it is said.
  let scrub = (text: string) => text;
  const say = (line: string) => io.say(scrub(line));
  const openBrowser = io.openBrowser ?? macOpen;
  const session = openPlan({
    ...options,
    openExternal: async (url) => {
      say(`Sign in to ChatGPT in your browser: ${url}`);
      await openBrowser(url);
    },
    onSignInEvent: (event: SignInEvent) => {
      if (event.type === 'device_code') say(`Or enter the code ${event.userCode} at ${event.verificationUri}`);
      if (event.type === 'progress') say('Finishing the sign-in…');
    },
  });
  scrub = session.scrub;
  say(`Signing the evals in to ChatGPT (kept in ${session.file}, never the app's vault).`);
  const status = await session.broker.signIn(PLAN_PROVIDER);
  if (!status.ok) throw new Error(scrub(`The sign-in didn't finish: ${status.error.code}${status.error.detail ? ` (${status.error.detail})` : ''}`));
  say(`Signed in${status.value.accountLabel ? ` as ${status.value.accountLabel}` : ''}. Run eval:design with --plan chatgpt --model <id>.`);
  return status.value;
}

/** Deletes the eval's sign-in file. */
export async function signOut(io: SignInIo, home?: string): Promise<boolean> {
  const removed = await deleteEvalCredentials(home);
  io.say(removed ? `Signed out: deleted ${evalCredentialsPath(home).file}.` : 'The evals were not signed in.');
  return removed;
}

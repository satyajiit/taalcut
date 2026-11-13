// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The evals' own ChatGPT sign-in (HFW1 dsn), so eval:design can run on the person's ChatGPT plan as their app does
 * without ever reading the app's vault or Keychain (signin.ts):
 *
 *   pnpm --filter @taalcut/evals eval:signin chatgpt    signs in (the app's flow: the browser, back to this Mac)
 *   pnpm --filter @taalcut/evals eval:signout chatgpt   deletes ~/.taalcut-eval/credentials.json
 */
import { signIn, signOut, type SignInIo } from './signin';

const [command, plan = 'chatgpt'] = process.argv.slice(2);
const io: SignInIo = { say: (line) => console.log(line) };
try {
  if (command === 'signin') await signIn(plan, io);
  else if (command === 'signout') await signOut(io);
  else throw new Error('usage: signin-cli.ts signin|signout chatgpt');
} catch (cause) {
  // Its own messages are scrubbed where they are made (signin.ts).
  console.error(cause instanceof Error ? cause.message : 'The sign-in failed.');
  process.exitCode = 1;
}

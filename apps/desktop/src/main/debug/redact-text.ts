// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Redacts text main itself produced (environment, logs, recovery) before the
 * bundle is scanned. Collector sections are left alone so the scan still sees
 * whatever that process put in them.
 */
import { REDACTED, scrubSecrets } from '@taalcut/models';
import { applyKnownSecrets, replaceHome, replaceMcpTokens, replacePaths } from '../crash/text-shapes';

export interface RedactionCounts {
  readonly text: number;
  readonly paths: number;
  readonly secrets: number;
}

export function redactText(
  text: string,
  options: { readonly secrets: readonly string[]; readonly homeDir: string },
): { text: string; redactions: RedactionCounts } {
  const known = applyKnownSecrets(text, options.secrets);
  const patterned = replaceMcpTokens(scrubSecrets(known.text)).text;
  const home = replaceHome(patterned, options.homeDir);
  const paths = replacePaths(home.text);
  return {
    text: paths.text,
    redactions: {
      text: 0,
      paths: home.count + paths.count,
      secrets: known.count + added(patterned, known.text),
    },
  };
}

function added(after: string, before: string): number {
  const count = (value: string) => value.split(REDACTED).length - 1;
  return Math.max(0, count(after) - count(before));
}

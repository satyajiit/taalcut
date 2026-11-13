// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * commands.dispatch through the page's probe client (window.taalcutProbe: the placeholder renderer's, or one
 * installAppClient left), as the person: 'ok' or the error code.
 */
import type { Evaluator } from './renderer-probes';

/** A Playwright page or the packaged tests' CDP page. */
export function dispatchAsPerson(page: Evaluator, name: string, payload: unknown): Promise<string> {
  return page.evaluate(
    async (command) => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) return 'no client';
      return rpc.commands.dispatch({ ...command, source: 'ui' }).then(
        () => 'ok',
        (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
      );
    },
    { name, payload },
  );
}

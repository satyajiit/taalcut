// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The scripted run the crash test kills and resumes, shared by the child
 * process (which dies mid-run) and the test (which finishes it), plus a
 * command bus that commits to a file with the idempotency core's bus will
 * have.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { ok } from '@taalcut/core';
import type { CommandDispatcher, ModelScript } from '@taalcut/agent';

export const CRASH_MESSAGE = 'Rename c1 to One and c2 to Two, and count the words in "a b c".';

/** Turn 1 renames c1. Turn 2 counts words and renames c2 in one go. Turn 3 reports. */
export const crashScript: ModelScript = (_request, turn) => {
  if (turn === 0)
    return { toolCalls: [{ name: 'updatePlan', arguments: { steps: [{ text: 'Rename both clips' }] } }] };
  if (turn === 1) return { toolCalls: [{ name: 'clips_renameClip', arguments: { id: 'c1', title: 'One' } }] };
  if (turn === 2) {
    return {
      toolCalls: [
        { name: 'clips_countWords', arguments: { text: 'a b c' } },
        { name: 'clips_renameClip', arguments: { id: 'c2', title: 'Two' } },
      ],
    };
  }
  return { text: 'Renamed both clips; the text has 3 words.' };
};

export interface AppliedCommand {
  readonly command: string;
  readonly payload: unknown;
  readonly key?: string;
}

export function readApplied(file: string): AppliedCommand[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AppliedCommand);
}

/** Commits each command to `file` before acknowledging it; refuses a key it has already committed. */
export function fileCommands(
  file: string,
  afterCommit: (command: AppliedCommand) => void = () => {},
): CommandDispatcher {
  return {
    async dispatch(command, payload, meta) {
      if (meta.idempotencyKey && readApplied(file).some((c) => c.key === meta.idempotencyKey))
        return ok({ applied: false });
      const entry: AppliedCommand = {
        command,
        payload,
        ...(meta.idempotencyKey ? { key: meta.idempotencyKey } : {}),
      };
      const fd = openSync(file, 'a');
      appendFileSync(fd, `${JSON.stringify(entry)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      afterCommit(entry);
      return ok({ applied: true });
    },
  };
}

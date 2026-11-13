// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a session row can do (P3-V4), one at a time: change its level, rename it and revoke it (person commands on
 * the bus), copy its setup again or mint a new key (main's mcpSetup: the bearer goes to the clipboard on main's
 * side and never reaches this window). Each says what happened in one line, or why it failed.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  MCP_COMMANDS,
  type McpLevel,
  type McpSessionView,
  type McpSetupFormat,
  type TaalcutError,
} from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { CLIENT_FORMATS } from './agent-words';

export type SessionWork = 'level' | 'rename' | 'revoke' | 'copy' | 'rotate' | null;

export interface SessionActions {
  /** The control that's working, which spins. */
  readonly working: SessionWork;
  readonly error: TaalcutError | null;
  /** What the last action did, in one line (announced). */
  readonly said: string | null;
  setLevel(level: McpLevel): void;
  copy(format: McpSetupFormat): void;
  rotate(): void;
  revoke(): void;
  /** Resolves once the rename has an answer, either way. */
  rename(name: string): Promise<void>;
}

export function useSessionActions(session: McpSessionView): SessionActions {
  const { t } = useLingui();
  const backend = useBackend();
  const command = useCommand({ toast: false });
  const [working, setWorking] = useState<SessionWork>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const act = async (
    kind: SessionWork,
    run: () => Promise<{ ok: boolean; error?: TaalcutError }>,
    done?: string,
  ) => {
    setWorking(kind);
    setError(null);
    setSaid(null);
    const result = await run();
    setWorking(null);
    if (!result.ok) return setError(result.error ?? null);
    if (done) setSaid(done);
  };
  const dispatch = (name: string, payload: unknown) => () => command.run({ name, payload });
  const sessionId = session.id;

  return {
    working,
    error,
    said,
    setLevel: (level) => void act('level', dispatch(MCP_COMMANDS.setSessionLevel, { sessionId, level })),
    copy: (format) =>
      void act('copy', () => callRpc(backend.mcpSetup.copySetup({ sessionId, format })), t`Copied.`),
    rotate: () =>
      void act(
        'rotate',
        () => callRpc(backend.mcpSetup.rotateToken({ sessionId, copy: CLIENT_FORMATS[session.client][0] })),
        t`New key copied. The old one stopped working.`,
      ),
    revoke: () =>
      void act(
        'revoke',
        dispatch(MCP_COMMANDS.revokeSession, { sessionId }),
        t`Revoked. It can’t act any more.`,
      ),
    rename: (name) => act('rename', dispatch(MCP_COMMANDS.renameSession, { sessionId, name })),
  };
}

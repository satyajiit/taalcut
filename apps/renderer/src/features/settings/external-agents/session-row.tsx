// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: an external agent's session · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a hairline row: its name as written, the app, its state in words (a chip with an icon),
 *   calls today and when it was last used (the app's name only when the session is called something else); what it
 *   may do as a segmented control (changes at once, the bus's own undo); Copy setup again, New key, Rename, See
 *   activity; Revoke last, immediate and said in danger ink on a quiet button as Privacy's standing consents do
 *   ("Revoked. It can't act any more.": no undo, by design). Revoked and expired rows grey out and keep only
 *   their history.
 * parts: session-name.tsx (the name, the rename form, the facts), session-controls.tsx (the level, the buttons),
 *   use-session-actions.ts (what each does)
 * states: default · hover (row surface) · focus (base ring on each control) · active · disabled (revoked, expired) ·
 *   loading (the control that's working spins) · error (ErrorLine under the row) · success (Copied, Revoked,
 *   announced) · highlighted (opened from an approval card: the row is scrolled to and focused)
 */
import { Plural, Trans } from '@lingui/react/macro';
import type { McpSessionView } from '@taalcut/core';
import { ErrorLine, cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionButtons, SessionLevel } from './session-controls';
import { isGone, RenameForm, SessionFacts, SessionName } from './session-name';
import { useSessionActions } from './use-session-actions';

export function SessionRow({ session, highlighted }: { session: McpSessionView; highlighted: boolean }) {
  const actions = useSessionActions(session);
  const ref = useRef<HTMLLIElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.name);
  const gone = isGone(session);

  useEffect(() => {
    if (!highlighted) return;
    ref.current?.scrollIntoView({ block: 'center' });
    ref.current?.focus();
  }, [highlighted]);

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === session.name) return setRenaming(false);
    void actions.rename(next).then(() => setRenaming(false));
  };

  return (
    <li
      ref={ref}
      tabIndex={highlighted ? -1 : undefined}
      data-session={session.id}
      data-status={session.status}
      className={cn(
        'flex flex-col gap-3 border-t border-rule-subtle py-4 outline-none first:border-t-0',
        highlighted && 'rounded-md bg-selected px-3',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          {renaming ? (
            <RenameForm
              name={name}
              busy={actions.working === 'rename'}
              onName={setName}
              onSubmit={rename}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <SessionName session={session} />
          )}
          <SessionFacts session={session} />
        </div>
        {gone ? null : (
          <Link
            to="/chat/$conversationId"
            params={{ conversationId: session.conversationId }}
            className="type-label-sm text-primary-strong underline underline-offset-2 hover:decoration-2"
          >
            {session.pendingApprovals > 0 ? (
              <Plural value={session.pendingApprovals} one="# waiting for you" other="# waiting for you" />
            ) : (
              <Trans>See activity</Trans>
            )}
          </Link>
        )}
      </div>
      {gone ? null : (
        <>
          <SessionLevel session={session} actions={actions} />
          <SessionButtons session={session} actions={actions} onRename={() => setRenaming(true)} />
        </>
      )}
      <p role="status" className="m-0 type-body text-ink empty:hidden">
        {actions.said}
      </p>
      {actions.error ? <ErrorLine error={actions.error} /> : null}
    </li>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: an external agent's session, its name and facts · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3
 * the name as written (translate="no") after a quiet bot mark, or the rename form in its place (an input, Save,
 *   Cancel); under it the facts in ink-2: the app (only when the session is called something else), its state
 *   in words on a chip with an icon, when it was last used, its calls today.
 * states: default · hover/focus/active (Input, Button) · disabled (revoked, expired: disabled ink) · loading (Save
 *   spins) · error (the row's ErrorLine) · success (the new name shows)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { McpSessionView } from '@taalcut/core';
import { Button, Chip, Input, ProviderLogo, UserContent, cn, useFormatters } from '@taalcut/ui';
import { Bot, CircleCheck, CircleOff, Clock } from 'lucide-react';
import type { FormEvent } from 'react';
import { CLIENT_WORDS, STATUS_WORDS } from './agent-words';

/** Revoked and expired sessions keep only their history. */
export const isGone = (session: McpSessionView) =>
  session.status === 'revoked' || session.status === 'expired';

export function SessionName({ session }: { session: McpSessionView }) {
  const gone = isGone(session);
  return (
    <p className="m-0 flex items-center gap-2 type-label text-ink">
      {session.client === 'other' ? (
        <Bot aria-hidden className={cn('size-4 shrink-0', gone ? 'text-ink-disabled' : 'text-ink-3')} />
      ) : (
        <ProviderLogo
          provider={session.client}
          size="xs"
          framed={false}
          className={cn(gone ? 'text-ink-disabled opacity-50' : 'text-ink-2')}
        />
      )}
      <UserContent translate="no" className={gone ? 'text-ink-disabled' : undefined}>
        {session.name}
      </UserContent>
    </p>
  );
}

export function RenameForm({
  name,
  busy,
  onName,
  onSubmit,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onName: (name: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={t`Name`}
        value={name}
        maxLength={60}
        autoFocus
        onChange={(event) => onName(event.target.value)}
        className="w-56"
      />
      <Button type="submit" size="sm" loading={busy}>
        <Trans>Save</Trans>
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        <Trans>Cancel</Trans>
      </Button>
    </form>
  );
}

function StatusChip({ session }: { session: McpSessionView }) {
  const { t, i18n } = useLingui();
  const gone = isGone(session);
  const StatusIcon = gone ? CircleOff : session.status === 'active' ? CircleCheck : Clock;
  return (
    <Chip tone={!gone && session.status === 'active' ? 'success' : 'neutral'} className="gap-1">
      <StatusIcon aria-hidden className="size-3" />
      {session.lastUsedAt === null && !gone
        ? t`Waiting for it to connect`
        : i18n._(STATUS_WORDS[session.status])}
    </Chip>
  );
}

export function SessionFacts({ session }: { session: McpSessionView }) {
  const { i18n } = useLingui();
  const format = useFormatters();
  const clientWord = i18n._(CLIENT_WORDS[session.client]);
  const lastUsed = session.lastUsedAt === null ? null : format.relativeDay(session.lastUsedAt);
  // The app's name only when the person named the session something else.
  const namedOtherwise = clientWord.localeCompare(session.name, undefined, { sensitivity: 'base' }) !== 0;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-ink-2">
      {namedOtherwise ? (
        <>
          <span>{clientWord}</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <StatusChip session={session} />
      {lastUsed ? (
        <>
          <span aria-hidden>·</span>
          <span>
            {/* Intl's words for the day, in a <time> as every Intl-formatted moment is. */}
            <Trans>
              Last used{' '}
              <time dateTime={new Date(session.lastUsedAt ?? 0).toISOString()} className="font-sans">
                {lastUsed}
              </time>
            </Trans>
          </span>
        </>
      ) : null}
      {session.callsToday > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            <Plural value={session.callsToday} one="# call today" other="# calls today" />
          </span>
        </>
      ) : null}
    </p>
  );
}

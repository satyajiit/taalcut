// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: an external agent's session, its controls · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3
 * what it may do as a segmented control (changes at once, the bus's own undo) with the level's line under it;
 *   then Copy setup again (per format), New key, Rename, and Revoke access last: immediate and said in danger
 *   ink on a quiet button, as Privacy's standing consents do.
 * states: default · hover/focus/active (Segmented, Button) · disabled (n/a: a gone session has no controls)
 *   · loading (the control that's working spins; the group is busy) · error (the row's ErrorLine) · success
 *   (the row's announced line)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { MCP_LEVELS, type McpLevel, type McpSessionView } from '@taalcut/core';
import { Button, Segmented, UserContent } from '@taalcut/ui';
import { useId } from 'react';
import { CLIENT_FORMATS, FORMAT_WORDS, LEVEL_WORDS } from './agent-words';
import type { SessionActions } from './use-session-actions';

export function SessionLevel({ session, actions }: { session: McpSessionView; actions: SessionActions }) {
  const { i18n } = useLingui();
  const sessionName = session.name;
  const levelName = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {/* The group's name is a sentence with the session's own name in it: the name stays as written. Hidden,
          so it names the group without being read again in the row's reading order. */}
      <span id={levelName} hidden>
        <Trans>
          What <UserContent translate="no">{sessionName}</UserContent> may do
        </Trans>
      </span>
      <Segmented
        labelledBy={levelName}
        value={session.level}
        options={MCP_LEVELS.map((level) => ({ value: level, label: i18n._(LEVEL_WORDS[level].name) }))}
        busy={actions.working === 'level'}
        className="self-start"
        onChange={(level: McpLevel) => actions.setLevel(level)}
      />
      <p className="m-0 type-body text-ink-2">{i18n._(LEVEL_WORDS[session.level].line)}</p>
    </div>
  );
}

export function SessionButtons({
  session,
  actions,
  onRename,
}: {
  session: McpSessionView;
  actions: SessionActions;
  onRename: () => void;
}) {
  const { i18n } = useLingui();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CLIENT_FORMATS[session.client].map((each) => (
        <Button
          key={each}
          size="sm"
          variant="secondary"
          loading={actions.working === 'copy'}
          onClick={() => actions.copy(each)}
        >
          {i18n._(FORMAT_WORDS[each])}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        loading={actions.working === 'rotate'}
        onClick={() => actions.rotate()}
      >
        <Trans>New key</Trans>
      </Button>
      <Button size="sm" variant="ghost" onClick={onRename}>
        <Trans>Rename</Trans>
      </Button>
      {/* Quiet, as Privacy's standing consents: a row of red fills would shout over the page. */}
      <Button
        size="sm"
        variant="secondary"
        className="ms-auto text-danger-strong hover:text-danger-strong"
        loading={actions.working === 'revoke'}
        onClick={() => actions.revoke()}
      >
        <Trans>Revoke access</Trans>
      </Button>
    </div>
  );
}

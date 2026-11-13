// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: transcript · mode: Operate
 * system: DESIGN.md v0.3 (A1, A3, A7) · motion: one entrance (Arrival) for the agent's new items, status marks,
 *   live timers; nothing animates on load, and your own messages land at once (they're what you just typed)
 * states: n/a (its children carry theirs) · your message on its way (shown at once) · not sent (its footer)
 * UX round 1: one marigold primary (the newest card that asks holds it; older ones go secondary); the message you
 *   sent shows the moment you send it, and one that didn't go says "Not sent" where you wrote it
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */

import { Trans } from '@lingui/react/macro';
import type { RunId, SelectionChip } from '@taalcut/core';
import {
  Arrival,
  Button,
  CardView,
  ChatMessage,
  MarkdownText,
  PrimaryHolderProvider,
  Reasoning,
  RunBlock,
  UnsupportedCard,
  VERB_ICONS,
} from '@taalcut/ui';
import { CircleAlert, CircleCheck, CirclePause, CircleStop, Wallet } from 'lucide-react';
import { memo, useMemo, useRef, type ReactNode } from 'react';
import { PointerChips } from './pointer-chips';
import { SentChips } from './sent-chips';
import type { Notice as NoticeKind, Transcript, TranscriptItem } from './transcript';
import { primaryHolder, transcriptRows, type Row } from './transcript-rows';

/** A message you sent that isn't in the conversation yet: on its way, or it didn't go (UX round 1). */
export interface Outgoing {
  readonly key: string;
  readonly text: string;
  readonly selections: readonly SelectionChip[];
  readonly failed: boolean;
}

const NOTICES: Record<NoticeKind, { icon: ReactNode; text: ReactNode }> = {
  cancelled: {
    icon: <CircleStop />,
    text: <Trans>Stopped. Completed work is kept.</Trans>,
  },
  paused: {
    icon: <CirclePause />,
    text: <Trans>Waiting for your answer. A new message counts as “Not now”.</Trans>,
  },
  budget: {
    icon: <Wallet />,
    text: (
      <Trans>This chat reached its budget, so Taalcut paused. Raise the budget in Settings to go on.</Trans>
    ),
  },
  // An answer to a run that had already ended (agent.run_finished): nothing went wrong.
  ended: {
    icon: <CircleCheck />,
    text: (
      <Trans>This had already ended, so your answer wasn’t needed. Send a new message to carry on.</Trans>
    ),
  },
};

/**
 * A line about a run, under it. A run waiting for an answer can still be
 * stopped, by id, without answering: its line ends in a Stop button of its own.
 */
function Notice({ kind, onStop }: { kind: keyof typeof NOTICES; onStop?: (() => void) | undefined }) {
  const { icon, text } = NOTICES[kind];
  return (
    <div data-slot="chat-notice" data-notice={kind} className="flex max-w-[42rem] items-center gap-3">
      <p className="m-0 flex min-w-0 flex-1 items-start gap-2 text-sm text-ink-2">
        <span
          aria-hidden
          className="inline-flex [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-ink-3"
        >
          {icon}
        </span>
        <span className="min-w-0">{text}</span>
      </p>
      {onStop ? (
        <Button variant="secondary" size="sm" icon={VERB_ICONS.stop} className="shrink-0" onClick={onStop}>
          <Trans>Stop</Trans>
        </Button>
      ) : null}
    </div>
  );
}

const Item = memo(function Item({
  item,
  onStopRun,
}: {
  item: TranscriptItem;
  onStopRun?: ((runId: RunId) => void) | undefined;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <ChatMessage
          role="user"
          text={item.text}
          {...(item.selections?.length || item.pointers?.length
            ? {
                attachments: (
                  <>
                    {item.selections?.length ? <SentChips chips={item.selections} /> : null}
                    {item.pointers?.length ? <PointerChips pointers={item.pointers} /> : null}
                  </>
                ),
              }
            : {})}
        />
      );
    case 'agent':
      return <ChatMessage role="agent" text={item.text} streaming={item.streaming} />;
    case 'reasoning':
      return (
        <Reasoning
          text={item.text}
          working={item.working}
          {...(item.endedAt === undefined ? {} : { elapsedMs: item.endedAt - item.startedAt })}
        />
      );
    case 'card':
      return <CardView card={item.card} />;
    case 'unsupported':
      return <UnsupportedCard />;
    case 'notice':
      return (
        <Notice
          kind={item.notice}
          onStop={item.notice === 'paused' && onStopRun ? () => onStopRun(item.runId) : undefined}
        />
      );
  }
});

function Activity({ row, responding }: { row: Extract<Row, { kind: 'run' }>; responding: boolean }) {
  const thought = row.notes.findLast(
    (note): note is Extract<TranscriptItem, { kind: 'reasoning' }> =>
      note.kind === 'reasoning' && note.working,
  );
  // The provider's current paragraph is a preview, not a generated description of its tool calls.
  const preview = (thought?.currentText ?? thought?.text)
    ?.trim()
    .split(/\n\s*\n/)
    .at(-1);
  return (
    <RunBlock
      {...(row.status ? { status: row.status } : {})}
      {...(row.plan ? { plan: row.plan } : {})}
      tools={row.tools}
      costs={row.costs}
      thinking={Boolean(thought) && !responding}
      responding={responding}
      preview={
        preview ? (
          <p translate="no" data-user-content className="m-0 break-words">
            {preview}
          </p>
        ) : undefined
      }
    >
      {row.notes.length > 0 ? (
        <div data-slot="activity-notes" className="flex min-w-0 flex-col gap-3">
          {row.notes.map((note) => (
            <div key={note.key} data-activity-note={note.kind} className="min-w-0">
              {note.kind === 'reasoning' ? (
                <p className="mb-1 type-label text-ink-2">
                  <Trans>Reasoning</Trans>
                </p>
              ) : null}
              <MarkdownText
                text={note.kind === 'reasoning' ? (note.segments?.join('\n\n') ?? note.text) : note.text}
                className="max-w-[65ch] text-sm text-ink-2"
              />
            </div>
          ))}
        </div>
      ) : null}
    </RunBlock>
  );
}

/**
 * The conversation, oldest first: your messages on the right, the agent's
 * words on the canvas, each run's work as one block, and only decisions as
 * cards. New text is announced politely to screen readers. What was there
 * when the page opened shows at once; what arrives after gets the one entrance.
 */
export function TranscriptView({
  items,
  runs,
  onStopRun,
  outgoing,
}: {
  items: readonly TranscriptItem[];
  /** The actual run state, including pauses and failures after its last tool finished. */
  runs?: Transcript['runs'];
  /** Stops a run that waits for an answer (the Stop on its paused line). */
  onStopRun?: (runId: RunId) => void;
  /** The message you just sent, until the conversation has it (or it didn't go). */
  outgoing?: Outgoing | null;
}) {
  const rows = useMemo(() => transcriptRows(items, runs), [items, runs]);
  const holder = useMemo(() => primaryHolder(items), [items]);
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(rows.map((row) => row.key));
  const initial = seen.current;
  return (
    <PrimaryHolderProvider holder={holder}>
      <ol
        data-slot="transcript"
        className="m-0 flex list-none flex-col gap-5 p-0"
        aria-live="polite"
        aria-relevant="additions"
      >
        {rows.map((row) => (
          <li key={row.key} data-item={row.kind === 'run' ? 'run' : row.item.kind} className="flex flex-col">
            <Arrival
              animate={!initial.has(row.key) && !(row.kind === 'item' && row.item.kind === 'user')}
              className="flex flex-col"
            >
              {row.kind === 'run' ? (
                <Activity
                  row={row}
                  responding={items.some(
                    (item) => item.kind === 'agent' && item.runId === row.runId && item.streaming,
                  )}
                />
              ) : (
                <Item item={row.item} onStopRun={onStopRun} />
              )}
            </Arrival>
          </li>
        ))}
        {outgoing ? (
          <li
            key={outgoing.key}
            data-item="user"
            data-outgoing={outgoing.failed ? 'failed' : 'sending'}
            className="flex flex-col"
          >
            <OutgoingMessage message={outgoing} />
          </li>
        ) : null}
      </ol>
    </PrimaryHolderProvider>
  );
}

/**
 * Your message before the conversation has it: shown the moment you send it, as it will stay. One that didn't go
 * says so under your words; the cause and Try again are in the error line under the transcript.
 */
function OutgoingMessage({ message }: { message: Outgoing }) {
  return (
    <ChatMessage
      role="user"
      text={message.text}
      {...(message.selections.length ? { attachments: <SentChips chips={message.selections} /> } : {})}
      {...(message.failed
        ? {
            footer: (
              <>
                <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger-strong" />
                <Trans>Not sent</Trans>
              </>
            ),
          }
        : {})}
    />
  );
}

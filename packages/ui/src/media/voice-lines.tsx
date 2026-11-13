// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: voice lines · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the voiceover's lines as a list on the canvas (no boxes): the slot it plays over, the words (the AI's or yours,
 *   shown as written), its length, a rose "Off the beat" chip when its first word misses the beat, Play (the card's
 *   preview from the line's place, when the app's preview can) and Edit, which opens the words in place; Send
 *   change goes to the run (a paid follow-up: the agent shows its cost first)
 * states: default · hover/active/focus-visible (Button; the textarea's base ring) · playing (the line under the
 *   playhead: ink text and a marigold tick) · editing (textarea + Send change / Cancel; Escape cancels) · disabled
 *   (Send change with nothing changed) · loading (Send change while it goes) · error/success: the card's
 *   follow-up line under the list
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { VoiceLine } from '@taalcut/core';
import { Pencil, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { useTimecode } from '../make/timecode';

export interface VoiceLineRow {
  readonly line: VoiceLine;
  /** The slot's number on the cut; null when the line has no slot (or the cut isn't loaded). */
  readonly slot: number | null;
  /** Where its clip sits on the timeline, when placed. */
  readonly span: { readonly start: number; readonly frames: number } | null;
}

export interface VoiceLinesProps {
  rows: readonly VoiceLineRow[];
  /** The preview's frame, for the line under the playhead. */
  playhead: number | undefined;
  /** Plays the preview from a frame; undefined without a preview that can. */
  onPlay?: ((frame: number) => void) | undefined;
  /** Sends the new words to the run (true once on their way); undefined leaves Edit out. */
  onEdit?: ((row: VoiceLineRow, index: number, text: string) => Promise<boolean>) | undefined;
  /** The edit on its way (its index). */
  sending: number | null;
}

export function VoiceLines({ rows, playhead, onPlay, onEdit, sending }: VoiceLinesProps) {
  const { t } = useLingui();
  const [editing, setEditing] = useState<number | null>(null);
  // Each line's Draft or Final only says something when they differ.
  const showQuality = new Set(rows.map((row) => row.line.quality)).size > 1;
  return (
    <ol data-slot="voice-lines" aria-label={t`Voiceover lines`} className="m-0 flex list-none flex-col p-0">
      {rows.map((row, index) => (
        <LineItem
          key={row.line.id}
          row={row}
          index={index}
          playing={
            playhead !== undefined &&
            row.span !== null &&
            playhead >= row.span.start &&
            playhead < row.span.start + row.span.frames
          }
          editing={editing === index}
          showQuality={showQuality}
          onEditing={(open) => setEditing(open ? index : null)}
          onPlay={onPlay}
          onEdit={onEdit}
          sending={sending === index}
        />
      ))}
    </ol>
  );
}

interface LineItemProps {
  row: VoiceLineRow;
  index: number;
  playing: boolean;
  editing: boolean;
  showQuality: boolean;
  onEditing: (open: boolean) => void;
  onPlay: VoiceLinesProps['onPlay'];
  onEdit: VoiceLinesProps['onEdit'];
  sending: boolean;
}

function LineItem({
  row,
  index,
  playing,
  editing,
  showQuality,
  onEditing,
  onPlay,
  onEdit,
  sending,
}: LineItemProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const fieldId = useId();
  const [draft, setDraft] = useState(row.line.text);
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const n = i18n.number(index + 1);
  const slot = row.slot === null ? null : i18n.number(row.slot);
  const length = row.line.duration ? time.length(row.line.duration.value, row.line.duration.rate) : null;
  const changed = draft.trim() !== '' && draft.trim() !== row.line.text.trim();

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const close = () => {
    onEditing(false);
    setDraft(row.line.text);
    editButton.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <li
      data-slot="voice-line"
      data-playing={playing || undefined}
      className="flex flex-col gap-1.5 border-t border-rule-subtle py-2.5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2 tabular-nums">
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-pill', playing ? 'bg-playhead' : 'bg-transparent')}
        />
        <span className="font-semibold text-ink">
          {slot === null ? t`Line ${n}` : t`Line ${n} · slot ${slot}`}
        </span>
        {length ? <span>{length}</span> : null}
        {showQuality ? <span>{row.line.quality === 'final' ? t`Final` : t`Draft`}</span> : null}
        {row.line.offBeat ? (
          <Chip tone="beat" title={t`Its first word doesn’t land on the beat.`}>
            {t`Off the beat`}
          </Chip>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="sr-only">
            {t`New words for line ${n}`}
          </label>
          <textarea
            id={fieldId}
            ref={field}
            value={draft}
            rows={2}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-full resize-y rounded-md border border-rule-strong bg-raised px-3 py-2 text-base text-ink shadow-xs hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!changed}
              loading={sending}
              onClick={async () => {
                if (await onEdit?.(row, index, draft.trim())) onEditing(false);
              }}
            >
              {t`Send change`}
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              {t`Cancel`}
            </Button>
            <span className="text-xs text-ink-2">{t`A new take costs money: Taalcut shows the cost first.`}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <p className="m-0 min-w-0 flex-1 text-base text-ink">
            <UserContent translate="no">{row.line.text}</UserContent>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {onPlay && row.span ? (
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t`Play line ${n}`}
                onClick={() => row.span && onPlay(row.span.start)}
              >
                <Play aria-hidden />
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                ref={editButton}
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t`Edit line ${n}`}
                onClick={() => onEditing(true)}
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: memory item (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one remembered item inside a settings row (the caller's hairline <li>): its words as
 *   written (UserContent: never translated), then who it came from (MemorySourceBadge: teal you, violet AI) and when
 *   it last changed, and two quiet icon buttons, Edit and Delete, at the right. Edit turns the words into the memory
 *   text field in place, with where it applies under it (the caller's `scopeField`, which may move it to another
 *   scope), then Save (secondary: the page's one marigold is Add) and Cancel
 * states: default · hover (the row's hover surface) · focus-visible (base ring on each button) · active (pressed)
 *   · disabled (another row's change is on its way) · loading (Save or Delete spins, the field is read-only)
 *   · error (the cause under the words, with Try again on the toast's side) · success (silent: the list re-reads,
 *   a deletion's toast has Undo)
 * motion: none of its own
 */
import { useLingui } from '@lingui/react/macro';
import type { MemoryItemView, TaalcutError } from '@taalcut/core';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../components/button';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { useFormatters } from '#lib/format';
import { MemorySourceBadge } from './memory-source-badge';
import { MemoryTextField } from './memory-text-field';

export type MemoryItemBusy = 'save' | 'delete' | null;

export interface MemoryItemProps {
  readonly item: Pick<MemoryItemView, 'id' | 'text' | 'source' | 'updatedAt'>;
  /** core's MEMORY_TEXT_MAX. */
  readonly max: number;
  readonly editing: boolean;
  readonly busy: MemoryItemBusy;
  /** Another item's change is on its way: this one's buttons wait. */
  readonly disabled?: boolean;
  readonly error?: TaalcutError | null;
  onEdit(): void;
  onCancel(): void;
  /** While editing: where the item applies, which the caller owns (MemoryScopeField). */
  readonly scopeField?: ReactNode;
  /** False while the scope field still needs a choice (a project or template to pick): Save waits. */
  readonly scopeReady?: boolean;
  /** Save the trimmed words (and the caller's scope); the caller closes the editor once they are saved. */
  onSave(text: string): void;
  onDelete(): void;
  /** For "now" in tests and the preview. */
  readonly now?: number;
}

function Editor({
  item,
  max,
  busy,
  error,
  scopeField,
  scopeReady = true,
  onCancel,
  onSave,
}: MemoryItemProps) {
  const { t } = useLingui();
  const [text, setText] = useState(item.text);
  const trimmed = text.trim();
  const ready = trimmed.length > 0 && scopeReady;
  const save = () => {
    if (ready && busy === null) onSave(trimmed);
  };
  return (
    <div className="flex flex-col gap-2">
      <MemoryTextField
        // Edit moves focus into the words it opened.
        autoFocus
        value={text}
        max={max}
        onValueChange={setText}
        onSubmit={save}
        onCancel={onCancel}
        saving={busy === 'save'}
        invalid={Boolean(error)}
        aria-label={t`What Taalcut remembers`}
      />
      {scopeField}
      {error ? <ErrorLine key={error.code} error={error} /> : null}
      <div className="flex gap-2">
        <Button size="sm" loading={busy === 'save'} disabled={!ready} onClick={save}>
          {t`Save`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy === 'save'}>
          {t`Cancel`}
        </Button>
      </div>
    </div>
  );
}

export function MemoryItem(props: MemoryItemProps) {
  const { item, editing, busy, disabled = false, error, onEdit, onDelete, now } = props;
  const { t } = useLingui();
  const format = useFormatters();
  return (
    <div data-slot="memory-item" data-memory-id={item.id} className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editing ? (
          <Editor {...props} />
        ) : (
          <p className="m-0 type-body text-ink">
            <UserContent translate="no">{item.text}</UserContent>
          </p>
        )}
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 type-meta text-ink-2">
          <MemorySourceBadge source={item.source} />
          <span aria-hidden className="text-ink-3">
            ·
          </span>
          {/* Intl's words for when, in a <time> as every Intl-formatted moment is. */}
          <time dateTime={new Date(item.updatedAt).toISOString()}>
            {format.relativeDay(item.updatedAt, now)}
          </time>
        </p>
        {!editing && error ? <ErrorLine key={error.code} error={error} /> : null}
      </div>
      {editing ? null : (
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t`Edit`}
            data-action="edit"
            disabled={disabled || busy !== null}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t`Delete`}
            data-action="delete"
            loading={busy === 'delete'}
            disabled={disabled || busy === 'save'}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

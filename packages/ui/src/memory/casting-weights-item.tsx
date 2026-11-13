// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: casting weights item (LRN1-PREF) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the casting weights Taalcut learned, in a settings row like any memory item: how they
 *   lean as one sentence in the reader's language (from the item's data, never its English text), then where they
 *   came from (the violet Learned badge and how many of your choices taught it, or the teal "Adjusted by you" once
 *   you set them) and when, and two quiet icon buttons at the right: Adjust opens the editor in place, Reset
 *   deletes the item so casting goes back to its defaults (the toast's Undo brings it back)
 * states: default · hover (the row's) · focus-visible (base ring on each button) · active (pressed) · disabled
 *   (another row's change is on its way) · loading (Reset spins; Save's in the editor) · error (the cause under the
 *   provenance) · success (silent: the list re-reads; a reset's toast has Undo). Closing the editor puts focus back
 *   on Adjust
 * motion: none of its own
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { CastingWeights, MemoryItemView, TaalcutError } from '@taalcut/core';
import { RotateCcw, SlidersHorizontal, UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ErrorLine } from '../cards/error-line';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { useFormatters } from '#lib/format';
import { CastingWeightsEditor } from './casting-weights-editor';
import type { CastingWeightsRules } from './casting-weights-rules';
import { castingWeightsSentence, type CastingWeightsData } from './casting-weights-words';
import type { MemoryItemBusy } from './memory-item';
import { MemorySourceBadge } from './memory-source-badge';

export interface CastingWeightsItemProps {
  readonly item: Pick<MemoryItemView, 'id' | 'updatedAt'>;
  readonly data: CastingWeightsData;
  /** Core's rules for these weights, bound to their defaults (Settings → Memory builds them from core). */
  readonly rules: CastingWeightsRules;
  readonly editing: boolean;
  readonly busy: MemoryItemBusy;
  /** Another item's change is on its way: this one's buttons wait. */
  readonly disabled?: boolean;
  readonly error?: TaalcutError | null;
  onEdit(): void;
  onCancel(): void;
  onSave(weights: CastingWeights): void;
  /** Delete the item: casting is back on its defaults. */
  onReset(): void;
  /** For "now" in tests and the preview. */
  readonly now?: number;
}

function Provenance({ item, data, now }: Pick<CastingWeightsItemProps, 'item' | 'data' | 'now'>) {
  const { t } = useLingui();
  const format = useFormatters();
  const dot = (
    <span aria-hidden className="text-ink-3">
      ·
    </span>
  );
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 type-meta text-ink-2">
      <MemorySourceBadge source="learned" />
      {data.pairs === 0 ? (
        <Badge tone="you" data-adjusted="you">
          <UserRound aria-hidden />
          <Trans comment="Memory item badge: the creator set these learned casting weights themselves">
            Adjusted by you
          </Trans>
        </Badge>
      ) : (
        <>
          {dot}
          <span>
            {t({
              message: plural(data.pairs, {
                one: 'From # choice you made',
                other: 'From # choices you made',
              }),
              comment:
                'How many of the creator’s shot choices (a swap, a removal) the casting weights learned from',
            })}
          </span>
        </>
      )}
      {dot}
      {/* Intl's words for when, in a <time> as every Intl-formatted moment is. */}
      <time dateTime={new Date(item.updatedAt).toISOString()}>{format.relativeDay(item.updatedAt, now)}</time>
    </p>
  );
}

export function CastingWeightsItem(props: CastingWeightsItemProps) {
  const {
    item,
    data,
    rules,
    editing,
    busy,
    disabled = false,
    error,
    onEdit,
    onCancel,
    onSave,
    onReset,
    now,
  } = props;
  const { i18n, t } = useLingui();
  const adjust = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  // Closing the editor (Save, Cancel, Escape) took focus with it: back to Adjust, so Tab carries on from the row.
  useEffect(() => {
    const closed = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (closed && (document.activeElement === null || document.activeElement === document.body))
      adjust.current?.focus();
  }, [editing]);
  const provenance = <Provenance item={item} data={data} {...(now === undefined ? {} : { now })} />;
  return (
    <div
      data-slot="memory-item"
      data-memory-id={item.id}
      data-memory-kind="casting-weights"
      className="flex items-start gap-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editing ? (
          <CastingWeightsEditor
            data={data}
            rules={rules}
            busy={busy}
            error={error ?? null}
            onCancel={onCancel}
            onSave={onSave}
          >
            {provenance}
          </CastingWeightsEditor>
        ) : (
          <>
            <p data-slot="casting-weights-lean" className="m-0 type-body text-ink">
              {castingWeightsSentence(i18n, rules.lean(data.weights))}
            </p>
            {provenance}
            {error ? <ErrorLine key={error.code} error={error} /> : null}
          </>
        )}
      </div>
      {editing ? null : (
        <div className="flex shrink-0 gap-1">
          <Button
            ref={adjust}
            size="icon"
            variant="ghost"
            aria-label={t`Adjust`}
            data-action="edit"
            disabled={disabled || busy !== null}
            onClick={onEdit}
          >
            <SlidersHorizontal aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t`Reset to the defaults`}
            data-action="reset"
            loading={busy === 'delete'}
            disabled={disabled || busy === 'save'}
            onClick={onReset}
          >
            <RotateCcw aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

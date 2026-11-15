// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the other-shots panel holds (EDT2): a named list of the slot's shots in a row. What plays now comes first,
 * marked "In use" with who chose it; then the cast's other shots, best first, each with how much footage it has
 * from where it would start. Pressing one swaps it in with the command the cast board's frames send
 * (timeline.swapClip, from "alternate"), so Undo, the cast and the preview follow; the frames stay where they are
 * and the mark moves, so the next press lands on the shot under the pointer. How sure Taalcut was of its pick sits
 * beside the name, in the cast board's words.
 * states: default · hover (the hover surface; the frame plays its stretch) · focus (the base ring; ← → Home End
 *   move, Return or Space swaps, ↓ or Tab goes back to the clip) · active (pressed surface) · disabled (a locked
 *   clip, with the reason; a file too short for the clip, said on the shot) · loading (the pressed frame dims and
 *   is busy) · error (the command's cause in a line) · success (the mark moves; said to screen readers)
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { cn, Confidence, errorMessage, useTimecode } from '@taalcut/ui';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { KEYS } from '../keys';
import type { ClipView, TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { OptionFrame } from './option-frame';
import { certainlyTooShort, footageMs, inShownOrder, type ShotOption } from './shot-options';

const MS = { num: 1000, den: 1 } as const;

export interface OtherShotsListProps {
  /** The panel's name: "Other shots for scene 3". */
  label: string;
  /** The element the name is in, for the panel's own label. */
  labelId: string;
  clip: ClipView;
  model: TimelineModel;
  options: readonly ShotOption[];
  edits: Edits;
  lookup: ShotLookup;
  /** ↓ or Tab: back to the clip. */
  onBack: () => void;
}

export function OtherShotsList({
  label,
  labelId,
  clip,
  model,
  options,
  edits,
  lookup,
  onBack,
}: OtherShotsListProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const hintId = useId();
  const list = useRef<HTMLDivElement>(null);
  // The order it opened in: a swap moves the mark, not the frames.
  const [order] = useState(() => options.map((option) => option.key));
  const [stop, setStop] = useState(1);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [said, setSaid] = useState('');
  const shown = inShownOrder(options, order);
  const locked = clip.item.locked;
  const sceneMs = ((clip.end - clip.start) * 1000 * model.rate.den) / model.rate.num;
  const nameOf = (option: ShotOption) =>
    lookup.frameNow(option.candidate.assetId, option.candidate.shotId)?.name ?? null;
  const short = (option: ShotOption) =>
    certainlyTooShort(clip, model.rate, option.candidate, lookup.loaded(option.candidate.assetId));

  const swap = async (option: ShotOption) => {
    if (option.current || locked || busy !== null || edits.pending || short(option)) return;
    setBusy(option.key);
    setError(null);
    setSaid('');
    const result = await edits.swap(clip.item.id, option.candidate, 'alternate');
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const name = nameOf(option);
    setSaid(name ? t`Swapped in ${name}.` : t`Swapped.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = shown.length - 1;
    const to = (
      {
        ArrowRight: Math.min(last, stop + 1),
        ArrowLeft: Math.max(0, stop - 1),
        Home: 0,
        End: last,
      } as Record<string, number>
    )[event.key];
    if (to !== undefined) {
      event.preventDefault();
      list.current?.querySelector<HTMLElement>(`[data-option="${to}"]`)?.focus();
      return;
    }
    // Tab goes on from the clip, as if the panel were not in the way.
    if (event.key === KEYS.otherShotsBack) event.preventDefault();
    if (event.key === KEYS.otherShotsBack || event.key === 'Tab') onBack();
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p id={labelId} className="m-0 type-label text-ink">
          {label}
        </p>
        {clip.chosenBy === 'ai' && clip.cast ? (
          <Confidence value={clip.cast.confidence} reranked={clip.cast.note === 'reranked'} />
        ) : null}
      </div>
      <div
        ref={list}
        role="listbox"
        aria-labelledby={labelId}
        aria-describedby={locked ? hintId : undefined}
        aria-orientation="horizontal"
        data-slot="other-shots-list"
        className="flex items-start gap-1"
        onKeyDown={onKeyDown}
      >
        {shown.map((option, index) => {
          const name = nameOf(option);
          const footage = footageMs(option.candidate, lookup.loaded(option.candidate.assetId));
          const tooShort = !option.current && short(option);
          const off = !option.current && (locked || tooShort);
          const working = busy === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.current}
              aria-disabled={off || working || undefined}
              aria-busy={working || undefined}
              tabIndex={index === Math.min(stop, shown.length - 1) ? 0 : -1}
              title={name ?? undefined}
              data-option={index}
              data-current={option.current || undefined}
              onClick={() => void swap(option)}
              onFocus={() => {
                setStop(index);
                setOver(option.key);
              }}
              onBlur={() => setOver((now) => (now === option.key ? null : now))}
              onPointerEnter={() => setOver(option.key)}
              onPointerLeave={() => setOver((now) => (now === option.key ? null : now))}
              className={cn(
                'flex flex-col items-center gap-2 rounded-md border-0 bg-transparent p-1 text-ink transition-colors duration-(--dur-micro) ease-(--ease-out)',
                option.current
                  ? 'cursor-default'
                  : off
                    ? 'cursor-not-allowed'
                    : 'cursor-pointer hover:bg-hover active:bg-pressed',
              )}
            >
              <OptionFrame
                candidate={option.candidate}
                lookup={lookup}
                sceneMs={sceneMs}
                playing={over === option.key}
                marker={option.current ? clip.chosenBy : null}
                current={option.current}
                dimmed={working || off}
              />
              <span className="sr-only">
                {option.current ? t`In use` : t`Swap in this shot`}
                {name ? (
                  <>
                    {': '}
                    <span translate="no" data-user-content>
                      {name}
                    </span>
                  </>
                ) : null}
                {'. '}
              </span>
              <span
                aria-hidden={option.current || undefined}
                className={cn(
                  'type-caption whitespace-nowrap',
                  option.current ? 'font-semibold text-ink' : 'text-ink-2',
                )}
              >
                {option.current
                  ? t`In use`
                  : tooShort
                    ? t`Too short`
                    : footage !== null
                      ? time.length(footage, MS)
                      : '\u00a0'}
              </span>
            </button>
          );
        })}
      </div>
      {locked ? (
        <p id={hintId} className="m-0 w-0 min-w-full type-meta text-ink-2">
          {t`Locked: Taalcut and your edits leave it as it is. Unlock it to change it.`}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 w-0 min-w-full type-meta text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: pacing controls · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * two quiet rows under the bands: the chosen section's name and pacing in words, Slower and Faster (the drag's
 *   equal), the beats-per-cut menu, Split (S) and Merge with next (M); under them what the change would do ("4
 *   shots will be picked again"), Reset and Apply. Apply is a secondary button: the screen's one marigold fill is
 *   its own ("Export…", "Approve all")
 * states: buttons carry the eight (default, hover, focus-visible, active, disabled at the ends and while nothing
 *   changed, loading on Apply) · checking (the line says it is working out the new cuts) · error (the refusal in
 *   words) · waiting (Apply waits for the project's queue, and says so) · success (silent here: the toast, with
 *   Undo) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@taalcut/ui';
import { ChevronDown, Merge, Minus, Plus, RotateCcw, Scissors } from 'lucide-react';
import type { Template } from '@taalcut/core';
import {
  BEAT_CHOICES,
  fasterEnergy,
  mergeNext,
  middleSplit,
  slowerEnergy,
  splitAt,
  withBeats,
  withEnergy,
} from './energy-model';
import {
  bandName,
  beatsChoice,
  energyErrorWords,
  pacingWords,
  replanWords,
  slotsWords,
} from './pacing-words';
import type { Pacing } from './use-pacing';

export interface PacingControlsProps<P> {
  readonly pacing: Pacing<P>;
  readonly template: Template;
  /** 'video': shots are picked again; 'template': only slots change. */
  readonly kind: 'video' | 'template';
  readonly className?: string;
}

function StatusLine<P>({ pacing, kind }: Pick<PacingControlsProps<P>, 'pacing' | 'kind'>) {
  const { t, i18n } = useLingui();
  const { state, applying, applyError } = pacing;
  let words: string;
  let locked: string | null = null;
  let tone: 'quiet' | 'plain' | 'danger' = 'quiet';
  if (applying === 'waiting') words = t`Waiting for the other changes in this project to finish…`;
  else if (applyError) {
    words = energyErrorWords(i18n, applyError);
    tone = 'danger';
  } else if (state.status === 'planning') words = t`Working out the new cuts…`;
  else if (state.status === 'error') {
    words = energyErrorWords(i18n, state.error);
    tone = 'danger';
  } else if (state.status === 'ready') {
    const { changed, picks, lockedKept } = state.preview;
    words = kind === 'template' ? slotsWords(i18n, changed) : replanWords(i18n, picks, changed);
    if (kind === 'video' && lockedKept) locked = t`Your locked shot stays on the first new cut.`;
    tone = 'plain';
  } else words = t`Drag a section up for more energy, or use Faster and Slower.`;
  return (
    <p
      role="status"
      data-slot="pacing-status"
      data-state={applying === 'waiting' ? 'waiting' : state.status}
      className={cn(
        'm-0 min-w-0 flex-1 text-sm',
        tone === 'danger' ? 'text-danger-strong' : tone === 'plain' ? 'text-ink' : 'text-ink-3',
      )}
    >
      {words}
      {locked ? <span className="block text-ink-2">{locked}</span> : null}
    </p>
  );
}

export function PacingControls<P>({ pacing, template, kind, className }: PacingControlsProps<P>) {
  const { t, i18n } = useLingui();
  const { draft, selected, change } = pacing;
  const section = draft.sections[selected];
  if (!section) return null;
  const faster = fasterEnergy(section.energy);
  const slower = slowerEnergy(section.energy);
  const split = middleSplit(template, draft, selected);
  const canMerge = selected < draft.sections.length - 1;
  const ready = pacing.state.status === 'ready' && pacing.applying === 'no';
  const every = beatsChoice(i18n, section.beatsPerClip);

  return (
    <div data-slot="pacing-controls" className={cn('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-xs text-ink-3">{bandName(i18n, selected, draft.sections.length)}</span>
          <span className="text-sm font-medium text-ink" data-slot="pacing-words">
            {pacingWords(i18n, section.beatsPerClip)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={t`Pace of this section`}>
          <Button
            size="sm"
            variant="ghost"
            disabled={slower === null}
            onClick={() => slower !== null && change(withEnergy(draft, selected, slower))}
          >
            <Minus aria-hidden />
            {t`Slower`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={faster === null}
            onClick={() => faster !== null && change(withEnergy(draft, selected, faster))}
          >
            <Plus aria-hidden />
            {t`Faster`}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t`Beats per cut: ${every}`}>
                {beatsChoice(i18n, section.beatsPerClip)}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={String(section.beatsPerClip)}
                onValueChange={(value) => {
                  const beats = BEAT_CHOICES.find((choice) => String(choice) === value);
                  if (beats !== undefined) change(withBeats(draft, selected, beats));
                }}
              >
                {BEAT_CHOICES.map((choice) => (
                  <DropdownMenuRadioItem key={choice} value={String(choice)}>
                    {beatsChoice(i18n, choice)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            aria-keyshortcuts="S"
            title={t`Split this section in two (S)`}
            disabled={split === null}
            onClick={() => split !== null && change(splitAt(template, draft, selected, split))}
          >
            <Scissors aria-hidden />
            {t`Split`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-keyshortcuts="M"
            title={t`Merge with the next section (M)`}
            disabled={!canMerge}
            onClick={() => change(mergeNext(draft, selected))}
          >
            <Merge aria-hidden />
            {t`Merge with next`}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusLine pacing={pacing} kind={kind} />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={!pacing.canReset} onClick={pacing.reset}>
            <RotateCcw aria-hidden />
            {t`Reset`}
          </Button>
          <Button
            size="sm"
            data-slot="pacing-apply"
            disabled={!ready && pacing.applying === 'no'}
            loading={pacing.applying !== 'no'}
            onClick={() => void pacing.apply()}
          >
            {t`Apply`}
          </Button>
        </div>
      </div>
    </div>
  );
}

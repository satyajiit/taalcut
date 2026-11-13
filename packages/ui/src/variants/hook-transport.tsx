// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: hook transport (P3-V3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · Play the hooks and Play all over every preview of a compare view, from one clock: the
 *   button that started playback becomes the one Stop, so focus stays where it was; what plays is said in a polite
 *   live line ("The first 3s of each, again and again", "Variant 2, 3 of 4")
 * states: the kit's Button (default, hover, focus-visible, active, disabled; loading/error/success: n/a, playback
 *   is local) · playing (its button reads Stop with a square) · disabled (nothing ready to play)
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Play, Square } from 'lucide-react';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import type { HookClock } from './hook-clock';

export interface HookTransportProps {
  readonly clock: HookClock;
  /** The previews' labels, in order (the live line names the one playing). */
  readonly labels: readonly string[];
  readonly hookSeconds: number;
  readonly disabled?: boolean;
}

export function HookTransport({ clock, labels, hookSeconds, disabled = false }: HookTransportProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const span = format.duration(hookSeconds * 1000);
  const turn = labels[clock.turn] ?? '';
  const at = i18n.number(clock.turn + 1);
  const of = i18n.number(labels.length);
  const said =
    clock.mode === 'hooks'
      ? t`The first ${span} of each, again and again`
      : clock.mode === 'all'
        ? t`${turn}, ${at} of ${of}`
        : '';
  return (
    <div role="group" aria-label={t`Play the previews`} className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        data-slot="play-hooks"
        disabled={disabled}
        onClick={clock.mode === 'hooks' ? clock.stop : clock.playHooks}
      >
        {clock.mode === 'hooks' ? <Square aria-hidden /> : <Play aria-hidden />}
        {clock.mode === 'hooks' ? t`Stop` : t`Play the hooks`}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-slot="play-all"
        disabled={disabled}
        onClick={clock.mode === 'all' ? clock.stop : clock.playAll}
      >
        {clock.mode === 'all' ? <Square aria-hidden /> : null}
        {clock.mode === 'all' ? t`Stop` : t`Play all`}
      </Button>
      <p aria-live="polite" data-slot="hook-status" className="m-0 min-w-0 text-xs text-ink-2 tabular-nums">
        {said}
      </p>
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: Clean up speech panel (the dock) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a step panel, unboxed on the dock's canvas: what the cleanup would do in one sentence ("Remove 14 fillers,
 *   shorten 9 pauses, cut 2 retakes and add 3 punch-ins: 0:52 → 0:41"), the spans it removes hatched on the bed,
 *   the four switches with the pause slider, then Apply (secondary: the editor's one marigold fill is "Export…")
 * states: analysing (listening to the speech: a neutral bar, it is background work, never violet) · default ·
 *   re-planning (the sentence dims, aria-busy) · stale (the video changed: "Check again") · applying (Apply spins)
 *   · applied ("Cleaned up: 11s shorter"; the toast has Undo) · no speech found (one line) · error (the cause
 *   and Try again) · switches and buttons carry the eight · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, Timeline } from '@taalcut/core';
import {
  Button,
  cleanupErrorWords,
  CleanupSummary,
  CleanupSwitches,
  useFormatters,
  VERB_ICONS,
} from '@taalcut/ui';
import { CircleCheck, RefreshCw } from 'lucide-react';
import { useCleanupPlan } from './use-cleanup-plan';

export interface CleanupPanelProps {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
}

/**
 * P3-V9: whether this video is a talking head the dock can clean up: a clip that plays its own sound (enabled,
 * real-time video, not muted). Whether there is speech in it is the plan's to say ("No speech found").
 */
export function cleanupAvailable(timeline: Timeline | null): boolean {
  const video = timeline?.tracks[0];
  if (video?.kind !== 'video') return false;
  return video.items.some(
    (item) =>
      item.type === 'clip' &&
      item.enabled &&
      item.media.kind === 'video' &&
      item.speed === null &&
      !item.audio.muted,
  );
}

function filmSeconds(timeline: Timeline): number {
  const video = timeline.tracks[0];
  const frames = (video?.kind === 'video' ? video.items : []).reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );
  return (frames * timeline.canvas.rate.den) / timeline.canvas.rate.num;
}

/** P3-V9: the dock's Clean up speech panel. */
export function CleanupPanel({ projectId, timeline }: CleanupPanelProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const cleanup = useCleanupPlan(projectId, timeline);
  const { state, plan, stale, applied } = cleanup;
  const before = filmSeconds(timeline);
  const noSpeech = state.status === 'error' && state.error.code === 'timeline.cleanup_no_speech';
  const nothing = plan
    ? plan.stats.fillers + plan.stats.pauses + plan.stats.retakes + plan.stats.punchIns === 0
    : true;

  let summary;
  if (state.status === 'analysing')
    summary = (
      <div role="status" className="flex flex-col gap-2" data-slot="cleanup-analysing">
        <p className="m-0 text-sm text-ink-2">{t`Listening to the speech…`}</p>
        <div aria-hidden className="h-1 overflow-hidden rounded-pill bg-hover">
          <span className="tc-global-loader-bar block h-full w-1/3 rounded-pill bg-ink-2" />
        </div>
      </div>
    );
  else if (noSpeech)
    summary = (
      <p className="m-0 text-sm text-ink-2" data-slot="cleanup-no-speech">
        {cleanupErrorWords(i18n, state.error)}
      </p>
    );
  else if (state.status === 'error')
    summary = (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-strong">
        {cleanupErrorWords(i18n, state.error)}
        <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={cleanup.checkAgain}>
          {t`Try again`}
        </Button>
      </div>
    );
  else if (applied !== null) {
    const shorter = format.duration(applied * 1000);
    summary = (
      <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink" data-slot="cleanup-applied">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
        {t`Cleaned up: ${shorter} shorter`}
      </p>
    );
  } else if (plan)
    summary = (
      <CleanupSummary
        plan={plan}
        timeline={null}
        before={before}
        after={Math.max(0, before - plan.stats.secondsSaved)}
        dimmed={cleanup.planning}
      />
    );

  return (
    <section
      data-slot="cleanup-panel"
      aria-labelledby="cleanup-panel-title"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id="cleanup-panel-title" className="m-0 text-base font-semibold text-ink">
          {t`Clean up speech`}
        </h2>
        <p className="m-0 text-sm text-ink-2">
          {t`Take out the ums, the long pauses and the retakes; punch in on the words you stress. Nothing changes until you apply.`}
        </p>
      </header>
      {summary}
      {stale ? (
        <p
          role="status"
          className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink"
          data-slot="cleanup-stale"
        >
          {t`Your video changed since this check.`}
          <Button size="sm" variant="secondary" loading={cleanup.planning} onClick={cleanup.checkAgain}>
            <RefreshCw aria-hidden />
            {t`Check again`}
          </Button>
        </p>
      ) : null}
      {noSpeech ? null : (
        <CleanupSwitches
          value={cleanup.switches}
          onChange={cleanup.change}
          disabled={cleanup.applying || state.status === 'analysing'}
          threshold
        />
      )}
      {cleanup.applyError ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {cleanupErrorWords(i18n, cleanup.applyError)}
        </p>
      ) : null}
      {noSpeech || applied !== null ? null : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-slot="cleanup-apply"
            loading={cleanup.applying}
            disabled={!plan || stale || nothing || cleanup.planning}
            onClick={() => void cleanup.apply()}
          >
            {t`Apply`}
          </Button>
        </div>
      )}
    </section>
  );
}

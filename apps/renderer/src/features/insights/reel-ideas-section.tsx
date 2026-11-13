// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · component: ReelIdeasSection · mode: Shape · system: DESIGN.md v0.7
 * Creative reel ideas with interactive 9:16 vertical Reel preview monitor (ReelIdeaStage),
 * scrubbable 4-scene timing strip (Hook · Build · Payoff · CTA), optional paired feed audio,
 * and one-click handoff into Create or Agent chat.
 * states: default · playing 9:16 reel preview · scene-scrubbed · playing paired track · hover
 * contrast: raised plate with rule hairline; viewer-black 9:16 stage; sunken scene & audio wells
 * reduced-motion: discrete scene cuts, instant play state transitions
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Chip, cn, CONCEPT_ICONS, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { EditsAudioTrack } from '../make/edits-pulse-model';
import { canPreviewTrack } from './audio-preview';
import { findSceneAtTime, ReelIdeaStage } from './reel-idea-stage';
import { buildReelIdeaSearch, getReelIdeas, pairedTrackForIdea, type ReelIdea } from './reel-ideas-data';
import { TrackCoverArt } from './track-cover-art';

const BeatIcon = CONCEPT_ICONS.beat;
const ReelIcon = CONCEPT_ICONS.reel;

const ROLE_BAR_TONE = {
  hook: 'bg-beat-strong',
  build: 'bg-ai-strong',
  payoff: 'bg-you-strong',
  cta: 'bg-ink-2',
} as const;

export function ReelIdeasSection({
  tracks,
  playingTrackId,
  previewVideoUrl,
  onTogglePlayTrack,
  onCutIdeaWithAgent,
}: {
  tracks: readonly EditsAudioTrack[];
  playingTrackId: string | null;
  previewVideoUrl?: string | null;
  onTogglePlayTrack: (track: EditsAudioTrack) => void;
  onCutIdeaWithAgent: (idea: ReelIdea, pairedTrack?: EditsAudioTrack) => void;
}) {
  const { t, i18n } = useLingui();
  const [playingIdeaId, setPlayingIdeaId] = useState<string | null>(null);
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});

  const ideas = getReelIdeas(i18n);
  const activeIdea = ideas.find((item) => item.id === playingIdeaId) ?? null;

  useEffect(() => {
    if (!activeIdea) return;
    const duration = Math.max(1, activeIdea.durationSeconds);
    const interval = setInterval(() => {
      setElapsedMap((prev) => {
        const current = prev[activeIdea.id] ?? 0;
        const next = current + 0.25;
        return {
          ...prev,
          [activeIdea.id]: next >= duration ? 0 : next,
        };
      });
    }, 250);
    return () => clearInterval(interval);
  }, [activeIdea]);

  const handleToggleIdeaPreview = useCallback(
    (idea: ReelIdea, pairedTrack?: EditsAudioTrack) => {
      setPlayingIdeaId((current) => {
        const nextPlaying = current === idea.id ? null : idea.id;
        if (nextPlaying && pairedTrack && canPreviewTrack(pairedTrack) && playingTrackId !== pairedTrack.id) {
          onTogglePlayTrack(pairedTrack);
        }
        return nextPlaying;
      });
    },
    [onTogglePlayTrack, playingTrackId],
  );

  const handleSeekScene = useCallback((ideaId: string, startSeconds: number) => {
    setElapsedMap((prev) => ({ ...prev, [ideaId]: startSeconds }));
    setPlayingIdeaId(ideaId);
  }, []);

  const timingLabel = (startSeconds: number, endSeconds: number) => {
    const start = i18n.number(startSeconds);
    const end = i18n.number(endSeconds);
    return t`${start}–${end}s`;
  };

  return (
    <section aria-label={t`Reel ideas`} data-slot="reel-ideas" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-ai-soft text-ai-strong">
              <ReelIcon aria-hidden className="size-3.5" />
            </span>
            <h2 className="m-0 type-section text-ink">
              <Trans>Reel ideas</Trans>
            </h2>
            <Chip tone="ai">{t`Starting points`}</Chip>
          </div>
          <p className="m-0 type-body text-ink-2">
            <Trans>
              Suggested scene plans for your footage. Adjust the timing and details to fit your story.
            </Trans>
          </p>
        </div>
      </div>

      <div
        role="list"
        aria-label={t`Reel idea starting points`}
        className="grid grid-cols-1 gap-3.5 md:grid-cols-2"
      >
        {ideas.map((idea) => {
          const pairedTrack = pairedTrackForIdea(idea, tracks);
          const canPreview = !!pairedTrack && canPreviewTrack(pairedTrack);
          const isTrackPlaying = Boolean(pairedTrack && playingTrackId === pairedTrack.id);
          const isIdeaPlaying = playingIdeaId === idea.id;
          const ideaElapsed = elapsedMap[idea.id] ?? 0;
          const activeScene = findSceneAtTime(idea.scenes, ideaElapsed).scene;
          const durationFormatted = i18n.number(idea.durationSeconds);
          const durationLabel = t`${durationFormatted}s`;

          return (
            <div
              key={idea.id}
              role="listitem"
              data-slot="reel-idea-card"
              data-idea-id={idea.id}
              data-playing={isIdeaPlaying ? 'true' : undefined}
              className={cn(
                'flex flex-col justify-between gap-3.5 rounded-xl border bg-raised p-4 shadow-xs transition-colors',
                isIdeaPlaying ? 'border-rule-strong' : 'border-rule',
              )}
            >
              {/* Header: Interactive 9:16 Reel Stage + Title & Format */}
              <div className="flex items-start justify-between gap-3.5">
                <div className="flex min-w-0 items-start gap-3.5">
                  <ReelIdeaStage
                    idea={idea}
                    playing={isIdeaPlaying}
                    elapsedSeconds={ideaElapsed}
                    previewVideoUrl={previewVideoUrl}
                    onTogglePlay={() => handleToggleIdeaPreview(idea, pairedTrack)}
                  />

                  <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone="ai">{idea.formatBadge}</Chip>
                      <span className="type-data text-ink-2">{durationLabel}</span>
                    </div>
                    <h3 className="m-0 type-card-title text-ink">{idea.title}</h3>
                    <p className="m-0 type-caption text-ink-2">{idea.description}</p>
                  </div>
                </div>
              </div>

              {/* Interactive Scene Timing Strip (Hook -> Build -> Payoff -> CTA) */}
              <div className="flex flex-col gap-2 rounded-lg bg-sunken px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 type-caption font-medium text-ink">
                    <BeatIcon aria-hidden className="size-3.5 text-beat-strong" />
                    {idea.hookFormula}
                  </span>
                </div>

                <div
                  aria-hidden
                  className="flex h-2 w-full gap-0.5 overflow-hidden rounded-pill bg-canvas p-0.5"
                >
                  {idea.scenes.map((scene) => (
                    <span
                      key={scene.label}
                      style={{ flexGrow: scene.endSeconds - scene.startSeconds }}
                      className={cn(
                        'h-full rounded-pill transition-opacity',
                        ROLE_BAR_TONE[scene.role],
                        isIdeaPlaying && activeScene.label !== scene.label && 'opacity-45',
                      )}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {idea.scenes.map((scene) => {
                    const isCurrentScene = isIdeaPlaying && activeScene.label === scene.label;
                    return (
                      <button
                        key={scene.label}
                        type="button"
                        onClick={() => handleSeekScene(idea.id, scene.startSeconds)}
                        className={cn(
                          'flex cursor-pointer flex-col rounded-md border bg-raised px-2 py-1 text-start transition-colors hover:bg-hover',
                          isCurrentScene ? 'border-beat-strong ring-1 ring-beat-strong/40' : 'border-rule',
                        )}
                      >
                        <span className="truncate type-caption font-medium text-ink">{scene.label}</span>
                        <span className="tc-mono text-[11px] text-ink-3">
                          {timingLabel(scene.startSeconds, scene.endSeconds)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paired Instagram Edits Audio Track */}
              {pairedTrack ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-rule bg-sunken px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <TrackCoverArt
                      track={pairedTrack}
                      playing={isTrackPlaying}
                      onTogglePlay={() => {
                        if (canPreview) onTogglePlayTrack(pairedTrack);
                      }}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="type-caption text-ink-3">
                        <Trans>Paired Instagram Edits sound</Trans>
                      </span>
                      <span className="truncate type-body font-medium text-ink">
                        <UserContent>{pairedTrack.title}</UserContent>
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate type-caption text-ink-2">
                          <UserContent>{pairedTrack.artistName}</UserContent>
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={isTrackPlaying ? VERB_ICONS.pause : VERB_ICONS.play}
                    aria-pressed={isTrackPlaying}
                    disabled={!canPreview}
                    onClick={() => onTogglePlayTrack(pairedTrack)}
                  >
                    {!canPreview ? t`Preview unavailable` : isTrackPlaying ? t`Pause` : t`Play`}
                  </Button>
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    icon={isIdeaPlaying ? VERB_ICONS.pause : VERB_ICONS.play}
                    aria-pressed={isIdeaPlaying}
                    onClick={() => handleToggleIdeaPreview(idea, pairedTrack)}
                  >
                    {isIdeaPlaying ? t`Pause reel` : t`Preview reel`}
                  </Button>
                  <Button asChild size="sm" icon={VERB_ICONS.makeVideo}>
                    <Link
                      to="/create/new"
                      search={buildReelIdeaSearch(idea, pairedTrack)}
                    >{t`Use idea`}</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={VERB_ICONS.newChat}
                    onClick={() => onCutIdeaWithAgent(idea, pairedTrack)}
                  >{t`Cut with AI`}</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

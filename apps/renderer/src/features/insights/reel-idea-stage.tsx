// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · component: ReelIdeaStage · mode: Shape · system: DESIGN.md v0.7
 * Interactive 9:16 vertical Reel preview monitor on bg-viewer (#0D0D0C). Steps through the 4 scene
 * cuts (Hook · Build · Payoff · CTA) in real time with scene-specific motion framing, live tabular
 * timecode, and optional muted video playback when a clip URL is supplied.
 * states: idle · playing · scene-scrubbed · hover · focus-visible
 * contrast: viewer-black 9:16 stage with on-viewer HUD labels and inverse ink Play/Pause control
 * reduced-motion: discrete scene cuts without continuous geometric drift
 */
import { useLingui } from '@lingui/react/macro';
import { cn, PRESS_CONTROL, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useRef } from 'react';
import type { ReelIdea, ReelIdeaScene } from './reel-ideas-data';

const PlayIcon = VERB_ICONS.play;
const PauseIcon = VERB_ICONS.pause;

const ROLE_ACCENT_TEXT = {
  hook: 'text-beat-strong',
  build: 'text-ai-strong',
  payoff: 'text-you-strong',
  cta: 'text-on-viewer',
} as const;

const ROLE_BAR_BG = {
  hook: 'bg-beat-strong',
  build: 'bg-ai-strong',
  payoff: 'bg-you-strong',
  cta: 'bg-on-viewer/80',
} as const;

export function findSceneAtTime(scenes: readonly ReelIdeaScene[], seconds: number): {
  scene: ReelIdeaScene;
  index: number;
} {
  for (let i = 0; i < scenes.length; i += 1) {
    const candidate = scenes[i]!;
    if (seconds >= candidate.startSeconds && seconds < candidate.endSeconds) {
      return { scene: candidate, index: i };
    }
  }
  const fallbackIndex = Math.max(0, scenes.length - 1);
  return { scene: scenes[fallbackIndex]!, index: fallbackIndex };
}

export function ReelIdeaStage({
  idea,
  playing,
  elapsedSeconds,
  previewVideoUrl,
  onTogglePlay,
}: {
  idea: ReelIdea;
  playing: boolean;
  elapsedSeconds: number;
  previewVideoUrl?: string | null;
  onTogglePlay: () => void;
}) {
  const { t, i18n } = useLingui();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { scene, index } = findSceneAtTime(idea.scenes, elapsedSeconds);
  const sceneStep = i18n.number(index + 1);
  const sceneTotal = i18n.number(idea.scenes.length);
  const currentFormatted = i18n.number(elapsedSeconds, {
    minimumFractionDigits: playing ? 1 : 0,
    maximumFractionDigits: 1,
  });
  const totalFormatted = i18n.number(idea.durationSeconds);
  const ideaTitle = idea.title;
  const buttonLabel = playing
    ? t`Pause reel preview for ${ideaTitle}`
    : t`Preview reel for ${ideaTitle}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <button
      type="button"
      data-slot="reel-idea-stage"
      data-playing={playing ? 'true' : undefined}
      data-active-role={scene.role}
      aria-label={buttonLabel}
      aria-pressed={playing}
      onClick={onTogglePlay}
      className={cn(
        'group/stage relative flex aspect-[9/16] w-24 shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-lg border bg-viewer p-2 text-start shadow-xs transition-all sm:w-28',
        playing ? 'border-beat-strong ring-2 ring-beat-strong/40' : 'border-rule hover:border-rule-strong',
        PRESS_CONTROL,
      )}
    >
      {/* Optional real video backdrop when supplied */}
      {previewVideoUrl ? (
        <video
          ref={videoRef}
          src={previewVideoUrl}
          muted
          loop
          playsInline
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-65"
        />
      ) : null}

      {/* Animated 9:16 Scene Composition SVG */}
      <svg
        aria-hidden
        viewBox="0 0 90 160"
        className={cn(
          'pointer-events-none absolute inset-0 size-full transition-colors duration-200',
          ROLE_ACCENT_TEXT[scene.role],
        )}
      >
        <rect width="90" height="160" fill="currentColor" opacity="0.08" />
        {/* 9:16 rule-of-thirds viewfinder guides */}
        <line x1="30" y1="0" x2="30" y2="160" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        <line x1="60" y1="0" x2="60" y2="160" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        <line x1="0" y1="53" x2="90" y2="53" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        <line x1="0" y1="106" x2="90" y2="106" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />

        {scene.role === 'hook' ? (
          <>
            <circle cx="45" cy="72" r="28" fill="currentColor" opacity="0.22" />
            <circle
              cx="45"
              cy="72"
              r="36"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              opacity="0.55"
            />
            <rect x="18" y="34" width="54" height="76" rx="6" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
          </>
        ) : scene.role === 'build' ? (
          <>
            <rect x="12" y="32" width="31" height="44" rx="4" fill="currentColor" opacity="0.24" />
            <rect x="47" y="32" width="31" height="44" rx="4" fill="currentColor" opacity="0.16" />
            <rect x="12" y="80" width="66" height="32" rx="4" fill="currentColor" opacity="0.28" />
          </>
        ) : scene.role === 'payoff' ? (
          <>
            <path d="M0 112 Q45 68 90 112 L90 160 L0 160 Z" fill="currentColor" opacity="0.28" />
            <circle cx="45" cy="64" r="22" fill="currentColor" opacity="0.32" />
            <rect x="10" y="26" width="70" height="96" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          </>
        ) : (
          <>
            <rect x="14" y="40" width="62" height="54" rx="6" fill="currentColor" opacity="0.2" />
            <rect x="14" y="100" width="62" height="16" rx="8" fill="currentColor" opacity="0.4" />
          </>
        )}
      </svg>

      {/* Top HUD: Scene index badge + Rec dot */}
      <div className="relative z-10 flex w-full items-center justify-between gap-1">
        <span className="rounded-sm bg-canvas/20 px-1 py-0.5 tc-mono text-[10px] leading-none font-semibold text-on-viewer backdrop-blur-xs">
          {t`${sceneStep}/${sceneTotal}`}
        </span>
        <span
          className={cn(
            'size-2 rounded-pill transition-transform',
            ROLE_BAR_BG[scene.role],
            playing && 'scale-125',
          )}
        />
      </div>

      {/* Center Play / Pause Disc */}
      <div className="relative z-10 my-auto flex flex-col items-center gap-1 self-center">
        <span className="flex size-8 items-center justify-center rounded-pill bg-inverse text-on-inverse shadow-sm transition-transform duration-(--dur-micro) group-hover/stage:scale-105">
          {playing ? (
            <PauseIcon className="size-3.5 fill-current" />
          ) : (
            <PlayIcon className="ms-0.5 size-3.5 fill-current" />
          )}
        </span>
      </div>

      {/* Bottom HUD: Active scene label + Segmented 9:16 progress bar */}
      <div className="relative z-10 flex w-full flex-col gap-1">
        <span className="truncate text-[10px] leading-tight font-semibold text-on-viewer drop-shadow-xs">
          {scene.label}
        </span>
        <div className="flex h-1 w-full gap-0.5 overflow-hidden rounded-pill bg-on-viewer/20">
          {idea.scenes.map((seg, idx) => {
            const segDuration = Math.max(0.1, seg.endSeconds - seg.startSeconds);
            const segProgress =
              elapsedSeconds <= seg.startSeconds
                ? 0
                : elapsedSeconds >= seg.endSeconds
                  ? 100
                  : ((elapsedSeconds - seg.startSeconds) / segDuration) * 100;
            const fillWidth = playing || elapsedSeconds > 0 ? segProgress : idx === 0 ? 100 : 35;
            return (
              <span
                key={seg.label}
                style={{ flexGrow: segDuration }}
                className="relative h-full overflow-hidden rounded-pill bg-on-viewer/20"
              >
                <span
                  style={{ width: `${fillWidth}%` }}
                  className={cn('block h-full rounded-pill transition-all duration-150', ROLE_BAR_BG[seg.role])}
                />
              </span>
            );
          })}
        </div>
        <span className="tc-mono text-[10px] leading-none font-medium text-on-viewer/85">
          {playing || elapsedSeconds > 0
            ? t`${currentFormatted}s / ${totalFormatted}s`
            : t`${totalFormatted}s`}
        </span>
      </div>
    </button>
  );
}

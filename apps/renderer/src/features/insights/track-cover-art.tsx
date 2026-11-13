// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · component: TrackCoverArt · mode: Operate · system: DESIGN.md v0.7
 * 64×64 studio album sleeve & vinyl cover art thumbnail with an overlaid ink Play/Pause disc.
 * states: default · hover · focus-visible · active (PRESS_CONTROL) · playing
 * contrast: viewer ground with semantic accent artwork; inverse ink play disc with on-inverse glyph
 * reduced-motion: static vinyl sleeve, no spinning loop
 */
import { useLingui } from '@lingui/react/macro';
import { cn, PRESS_CONTROL, VERB_ICONS } from '@taalcut/ui';
import type { EditsAudioTrack } from '../make/edits-pulse-model';
import { canPreviewTrack } from './audio-preview';

const PlayIcon = VERB_ICONS.play;
const PauseIcon = VERB_ICONS.pause;

function hashTrack(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function monogramOf(title: string, artist: string): string {
  const cleanArtist = artist.replace(/^@/, '').trim();
  const first = cleanArtist[0] ?? title[0] ?? 'T';
  const second = title.replace(/^Original audio\s*[—-]?\s*@?/i, '').trim()[0] ?? 'A';
  return `${first}${second}`.toUpperCase();
}

export function TrackCoverArt({
  track,
  playing,
  onTogglePlay,
  size = 'md',
}: {
  track: EditsAudioTrack;
  playing: boolean;
  onTogglePlay: () => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useLingui();
  const seed = hashTrack(track.id);
  const variant = seed % 4;
  const monogram = monogramOf(track.title, track.artistName);
  const playable = canPreviewTrack(track);
  const name = track.title;
  const label = !playable
    ? t`Preview unavailable for ${name}`
    : playing
      ? t`Pause preview for ${name}`
      : t`Play preview for ${name}`;

  const toneClass = track.isRoyaltyFree
    ? 'text-you-strong'
    : track.isLicensedMusic
      ? 'text-ai-strong'
      : 'text-beat-strong';

  const washClass = track.isRoyaltyFree
    ? 'bg-you-soft'
    : track.isLicensedMusic
      ? 'bg-ai-soft'
      : 'bg-beat-soft';

  return (
    <button
      type="button"
      data-slot="track-cover-art"
      data-playing={playing ? 'true' : undefined}
      aria-label={label}
      disabled={!playable}
      aria-pressed={playing}
      onClick={onTogglePlay}
      className={cn(
        'group/cover relative shrink-0 enabled:cursor-pointer overflow-hidden rounded-lg bg-viewer p-0 ring-1 ring-rule transition-shadow',
        size === 'sm' ? 'size-12' : 'size-16',
        playing && 'ring-2 ring-beat-strong',
        PRESS_CONTROL,
      )}
    >
      {/* Procedural Studio Album Sleeve SVG */}
      <svg aria-hidden viewBox="0 0 64 64" className={cn('size-full', toneClass)}>
        <rect width="64" height="64" className="fill-sunken" />
        {variant === 0 ? (
          <>
            <circle cx="48" cy="16" r="26" fill="currentColor" opacity="0.18" />
            <circle cx="16" cy="52" r="22" fill="currentColor" opacity="0.12" />
          </>
        ) : variant === 1 ? (
          <>
            <path d="M0 44 L64 18 L64 64 L0 64 Z" fill="currentColor" opacity="0.18" />
            <circle cx="20" cy="20" r="14" fill="currentColor" opacity="0.14" />
          </>
        ) : variant === 2 ? (
          <>
            <rect x="6" y="6" width="52" height="52" rx="10" fill="currentColor" opacity="0.15" />
            <path d="M6 36 Q32 18 58 36" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
          </>
        ) : (
          <>
            <circle cx="32" cy="32" r="26" fill="currentColor" opacity="0.14" />
            <circle
              cx="32"
              cy="32"
              r="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.3"
            />
          </>
        )}
        {/* Vinyl disc grooves */}
        <circle
          cx="32"
          cy="32"
          r="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="6 4"
          opacity="0.45"
        />
        <circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      </svg>

      {/* Top-left Artist Monogram Tag */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1 left-1 rounded-sm px-1 py-0.5 type-caption leading-none font-semibold',
          washClass,
          toneClass,
        )}
      >
        {monogram}
      </span>

      {/* A decorative sleeve never claims playback when the provider supplied no playable audio. */}
      {playable ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 m-auto flex items-center justify-center rounded-pill bg-inverse text-on-inverse shadow-sm transition-transform duration-(--dur-micro)',
            size === 'sm' ? 'size-6' : 'size-8',
            'group-hover/cover:scale-105',
          )}
        >
          {playing ? (
            <PauseIcon className="size-3.5 fill-current" />
          ) : (
            <PlayIcon className="ms-0.5 size-3.5 fill-current" />
          )}
        </span>
      ) : null}
    </button>
  );
}

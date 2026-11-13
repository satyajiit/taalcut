// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Chip, cn, CONCEPT_ICONS, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { buildCreateSearchFromTrack, type EditsAudioTrack } from '../make/edits-pulse-model';
import { canPreviewTrack } from './audio-preview';
import { TrackCoverArt } from './track-cover-art';

const SavedIcon = CONCEPT_ICONS.saved;

export function EditsTrackCard({
  track,
  playing,
  elapsedSeconds,
  saving,
  saveDisabled,
  onTogglePlay,
  onSeek,
  onToggleSave,
  onCutWithAgent,
}: {
  track: EditsAudioTrack;
  playing: boolean;
  elapsedSeconds: number;
  saving: boolean;
  saveDisabled: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onToggleSave: () => void;
  onCutWithAgent: () => void;
}) {
  const { t, i18n } = useLingui();
  const playable = canPreviewTrack(track);
  const knownDuration = track.durationSeconds > 0;
  const duration = i18n.number(Math.round(track.durationSeconds));
  const elapsed = i18n.number(elapsedSeconds, { maximumFractionDigits: 1 });

  return (
    <div
      role="listitem"
      data-slot="edits-track-card"
      data-track-id={track.id}
      data-playing={playing ? 'true' : undefined}
      className={cn(
        'flex flex-col justify-between gap-3.5 rounded-xl border bg-raised p-4 shadow-xs transition-colors',
        playing ? 'border-rule-strong' : 'border-rule',
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <TrackCoverArt track={track} playing={playing} onTogglePlay={onTogglePlay} />
        <div className="flex min-w-0 flex-col gap-1 pt-0.5">
          <span className="truncate type-card-title text-ink">
            <UserContent>{track.title}</UserContent>
          </span>
          <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-meta text-ink-2">
            <span className="truncate">
              <UserContent>{track.artistName}</UserContent>
            </span>
            {knownDuration ? (
              <>
                <span aria-hidden>·</span>
                <span className="type-data">
                  {playing ? t`${elapsed} s / ${duration} s` : t`${duration} s`}
                </span>
              </>
            ) : null}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {track.isRoyaltyFree ? (
              <Chip tone="you">{t`Provider: royalty-free`}</Chip>
            ) : track.isLicensedMusic ? (
              <Chip tone="ai">{t`Provider: IG licensed`}</Chip>
            ) : (
              <Chip tone="neutral">{t`Licence not supplied`}</Chip>
            )}
          </div>
        </div>
      </div>

      {track.highlights.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken px-3.5 py-2.5">
          <span className="type-meta text-ink-2">
            <Trans>Provider hook markers</Trans>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {track.highlights.map((seconds) => {
              const marker = i18n.number(seconds, { maximumFractionDigits: 1 });
              return (
                <button
                  key={seconds}
                  type="button"
                  disabled={!playable || !knownDuration}
                  onClick={() => onSeek(seconds)}
                  className="rounded-pill bg-beat-soft px-2 py-0.5 type-caption font-semibold text-beat-strong enabled:cursor-pointer enabled:hover:bg-hover"
                >{t`${marker} s`}</button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {playable ? (
            <Button
              size="sm"
              icon={playing ? VERB_ICONS.pause : VERB_ICONS.play}
              aria-pressed={playing}
              onClick={onTogglePlay}
            >
              {playing ? t`Pause` : t`Play preview`}
            </Button>
          ) : (
            <span className="type-meta text-ink-3">
              <Trans>Preview unavailable</Trans>
            </span>
          )}
          <Button asChild size="sm" icon={VERB_ICONS.makeVideo}>
            <Link to="/create/new" search={buildCreateSearchFromTrack(track)}>{t`Draft brief`}</Link>
          </Button>
          <Button size="sm" variant="ghost" icon={VERB_ICONS.newChat} onClick={onCutWithAgent}>
            <Trans>Cut with AI</Trans>
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={track.isSaved ? VERB_ICONS.approve : SavedIcon}
          aria-pressed={track.isSaved}
          disabled={track.isSaved || saveDisabled}
          loading={saving}
          onClick={onToggleSave}
        >
          {track.isSaved ? t`Saved` : t`Save audio`}
        </Button>
      </div>
    </div>
  );
}

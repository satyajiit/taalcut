// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: the sound lane (EDT1-OPS) · system: DESIGN.md v0.6
 * under the beats, what you hear and when: the music's stretch (its fades as ramps), each clip's own sound (its
 *   level and fades; a muted clip is a hatched outline), and the voice lines and sound effects at their times. A
 *   clip's sound selects its clip, and a voice line or effect selects itself (the inspector shows
 *   its sound), so the Sound controls are one press away. A small
 *   label stays at the lane's left while you scroll.
 * states: default · hover (hover surface) · focus-visible (the base ring) · selected (its clip selected: marigold
 *   edge) · muted (hatched, "muted" in its name) · empty (no music and no sound: the lane says so in one line) */
import { useLingui } from '@lingui/react/macro';
import { defaultMusicBed, type RationalTime, type TimelineItemId } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import type { CSSProperties } from 'react';
import { useEditorContext } from './editor-context';
import { toFrames } from './model';
import { ACTIVE_RING, useLaneListbox } from './use-lane-listbox';

export interface SoundLaneProps {
  pxPerFrame: number;
  selectedClipId: TimelineItemId | null;
  onSelectClip: (clipId: TimelineItemId) => void;
}

/** A fade drawn as a ramp: the block's corners cut away over its first and last frames of fade. */
function ramps(width: number, fadeIn: number, fadeOut: number): CSSProperties {
  if (fadeIn <= 0 && fadeOut <= 0) return {};
  const left = Math.min(width, fadeIn);
  const right = Math.max(0, width - fadeOut);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS shape, never shown
  return { clipPath: `polygon(0 100%, ${left}px 0, ${right}px 0, 100% 100%)` };
}

export function SoundLane({ pxPerFrame, selectedClipId, onSelectClip }: SoundLaneProps) {
  const { t, i18n } = useLingui();
  const editor = useEditorContext();
  const soundClips = editor?.model.clips.filter((clip) => clip.item.media.kind === 'video') ?? [];
  const lines = !editor
    ? []
    : editor.timeline.tracks.flatMap((track) => {
        if (track.kind !== 'audio') return [];
        let at = 0;
        return track.items.flatMap((item) => {
          const start = at;
          if (item.type !== 'transition') at += toFrames(item.duration, editor.model.rate);
          return item.type === 'clip' ? [{ item, role: track.role, start, end: at }] : [];
        });
      });
  const lineIds = new Set<TimelineItemId>(lines.map((line) => line.item.id));
  const selection = editor?.selection;
  const selectedLine =
    selection?.kind === 'item'
      ? (lines.find((line) => line.item.id === selection.itemId)?.item.id ?? null)
      : null;
  const selectLine = (itemId: TimelineItemId) =>
    editor?.select({ kind: 'item', timelineId: editor.timeline.id, itemId, itemKind: 'audio' });
  // EDT1 gate: the clips' sound and the voice lines are one listbox (one tab stop over the lane's height); each is
  // often narrower and shorter than a target can be, so the arrow keys move along them and Enter selects one.
  const lane = useLaneListbox(
    [...soundClips.map((clip) => clip.item.id), ...lines.map((line) => line.item.id)],
    selectedLine ?? selectedClipId,
    (id) => (lineIds.has(id) ? selectLine(id) : onSelectClip(id)),
  );
  if (!editor) return null;
  const { timeline, model } = editor;
  const rate = model.rate;
  const frames = (time: RationalTime | undefined) => (time ? toFrames(time, rate) : 0);
  const music =
    timeline.music.path === 'platformSound' || timeline.music.path === 'none'
      ? null
      : (timeline.mix.music ?? defaultMusicBed(rate));
  const level = (gainDb: number) => i18n.number(gainDb, { signDisplay: 'exceptZero' });

  return (
    <div data-slot="sound-lane" className="relative flex h-12 flex-col gap-0.5 py-0.5">
      <span
        aria-hidden
        className="pointer-events-none sticky left-1 z-10 w-fit rounded-sm bg-sunken/80 px-1 type-caption text-ink-3"
      >
        {t`Sound`}
      </span>
      <div className="absolute inset-x-0 top-0.5 h-3.5">
        {music ? (
          <div
            data-slot="sound-music"
            data-muted={music.muted || undefined}
            aria-label={music.muted ? t`Music, muted` : t`Music`}
            role="img"
            className={cn(
              'absolute top-0 h-3.5 rounded-sm bg-beat/35',
              music.muted && 'bg-transparent outline outline-1 outline-rule',
            )}
            style={{
              left: frames(music.start) * pxPerFrame,
              width: Math.max(
                4,
                ((music.end ? frames(music.end) : model.total) - frames(music.start)) * pxPerFrame,
              ),
              ...ramps(
                ((music.end ? frames(music.end) : model.total) - frames(music.start)) * pxPerFrame,
                frames(music.fadeIn) * pxPerFrame,
                frames(music.fadeOut) * pxPerFrame,
              ),
            }}
          />
        ) : null}
      </div>
      {lane.listbox['aria-activedescendant'] === undefined ? null : (
        <div
          {...lane.listbox}
          aria-label={t`Sound`}
          className="group pointer-events-none absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <div
            role="group"
            aria-label={t`Each clip’s own sound`}
            className="absolute inset-x-0 top-4.5 h-3.5"
          >
            {soundClips.map((clip) => {
              const n = i18n.number(clip.number);
              const { audio } = clip.item;
              const width = Math.max(4, (clip.end - clip.start) * pxPerFrame - 2);
              const db = level(audio.gainDb);
              const name = audio.muted ? t`Clip ${n}’s own sound, muted` : t`Clip ${n}’s own sound, ${db} dB`;
              return (
                <div
                  key={clip.item.id}
                  id={lane.optionId(clip.item.id)}
                  role="option"
                  aria-selected={clip.item.id === selectedClipId}
                  aria-label={name}
                  title={name}
                  data-active={clip.item.id === lane.active || undefined}
                  data-slot="sound-clip"
                  data-muted={audio.muted || undefined}
                  data-clip-id={clip.item.id}
                  className={cn(
                    'pointer-events-auto absolute top-0 h-3.5 cursor-pointer rounded-sm bg-ink-3/30 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-ink-3/45',
                    ACTIVE_RING,
                    audio.muted &&
                      'bg-[repeating-linear-gradient(135deg,var(--color-rule)_0_2px,transparent_2px_6px)] hover:bg-hover',
                    clip.item.id === selectedClipId && 'ring-1 ring-primary-strong',
                  )}
                  style={{
                    left: clip.start * pxPerFrame + 1,
                    width,
                    ...ramps(width, frames(audio.fadeIn) * pxPerFrame, frames(audio.fadeOut) * pxPerFrame),
                  }}
                  onClick={() => {
                    lane.setActive(clip.item.id);
                    onSelectClip(clip.item.id);
                  }}
                />
              );
            })}
          </div>
          {lines.length > 0 ? (
            <div
              role="group"
              aria-label={t`Voice and sound effects`}
              className="absolute inset-x-0 top-8.5 h-3"
            >
              {lines.map((line) => {
                const selected = line.item.id === selectedLine;
                return (
                  // EDT1-OPS: a press selects the line (ctx's select), and the inspector shows its sound controls.
                  <div
                    key={line.item.id}
                    id={lane.optionId(line.item.id)}
                    role="option"
                    aria-selected={selected}
                    aria-label={line.role === 'voice' ? t`A voice line` : t`A sound effect`}
                    data-active={line.item.id === lane.active || undefined}
                    data-slot="sound-line"
                    data-clip-id={line.item.id}
                    className={cn(
                      'pointer-events-auto absolute top-0 h-3 cursor-pointer rounded-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                      ACTIVE_RING,
                      line.role === 'voice'
                        ? 'bg-you-soft hover:bg-you-strong/40'
                        : 'bg-ai-soft hover:bg-ai-strong/40',
                      line.item.audio.muted && 'opacity-40',
                      selected && 'ring-1 ring-primary-strong',
                    )}
                    style={{
                      left: line.start * pxPerFrame,
                      width: Math.max(4, (line.end - line.start) * pxPerFrame - 1),
                    }}
                    onClick={() => {
                      lane.setActive(line.item.id);
                      selectLine(line.item.id);
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

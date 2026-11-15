// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: pick the part (TRIM1) · system: DESIGN.md v0.7 (Footage First; marigold the
 *   live choice; plain words)
 * the Trim tool for one scene, in the simple view and the detailed one alike: a picture, the whole clip as a strip
 *   with the part the scene plays as a window on it, one line saying what it plays, and steps of a frame and half
 *   a second. Dragging the window, or clicking another moment on the strip, plays another part (the scene keeps
 *   its place and length: timeline.slipClip, or timeline.swapClip into another shot of the same file); dragging
 *   an end makes the scene begin or end elsewhere
 *   (timeline.trimClip), and the line under it says what the scenes next to it do. Nothing is sent until the hand
 *   lets go; Escape puts it back. Play runs just the part, over and over. The exact Remove and Restore sit folded
 *   under it
 * states: default · hover (the frame under the pointer) · focus (the base ring on the window, an end, a button) ·
 *   dragging (the picture follows the end that moves; its time floats over it) · disabled (locked, the AI is
 *   editing or a change is on its way: the window greys, the steps are off, Play still plays) · loading (bones the
 *   size of the picture and the strip: nothing jumps) · no frames (a plain track and why; the times still hold) ·
 *   error (the file couldn't be read, or its original is away: said in one line with what still works) · refused
 *   (the window goes back and the line says why) · a photo or a held moment (no part to pick: the exact trim alone)
 * motion: none of its own: the window follows the hand; reduced motion changes nothing here but the fades
 */
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { Button, cn, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { frameRatio } from '../../library/clip/player/viewer-state';
import { useEditorContext } from '../editor-context';
import { mediaOf, type ClipView, type TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { ExactTrim } from './exact-trim';
import { msAt, partOf, type PartModel } from './part-model';
import { cutGrid } from './part-moves';
import { PartPicture } from './part-picture';
import { PartSays } from './part-says';
import { PartSteps } from './part-steps';
import { PartStrip } from './part-strip';
import { usePartWords } from './part-words';
import { usePartGestures, type PartGesture } from './use-part-gestures';
import { usePartPlayer } from './use-part-player';

export interface ClipPartProps {
  clip: ClipView;
  model: TimelineModel;
  edits: Edits;
  lookup: ShotLookup;
  /** The clip's own actions (Lock, Add to chat), at the end of the title's row. */
  actions?: ReactNode;
}

export function ClipPart({ clip, model, edits, lookup, actions }: ClipPartProps) {
  const { t, i18n } = useLingui();
  const assetId = mediaOf(clip.item).assetId;
  // The editor loads every file its timeline names; this is for a file that came since, and for Try again.
  const [fetched, setFetched] = useState<{ assetId: string; detail: AssetDetail | null } | null>(null);
  const detail = lookup.loaded(assetId) ?? (fetched?.assetId === assetId ? fetched.detail : undefined);
  const read = () => void lookup.detail(assetId).then((found) => setFetched({ assetId, detail: found }));
  useEffect(() => {
    if (lookup.loaded(assetId) === undefined) read();
  }, [assetId, lookup]);
  const part = useMemo(() => partOf(clip, model, detail), [clip, model, detail]);
  const n = i18n.number(clip.number);

  return (
    <section data-slot="clip-part" className="@container/part flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 type-card-title text-ink">{t`Pick the part scene ${n} plays`}</h2>
        {actions}
      </div>
      {part ? (
        <PartControl
          part={part}
          clip={clip}
          model={model}
          edits={edits}
          lookup={lookup}
          detail={detail}
          onRetry={read}
        />
      ) : (
        <p className="m-0 type-meta text-ink-2">
          {clip.item.media.kind === 'image'
            ? t`A photo shows whole, so there is no part to pick. You can still make the scene longer or shorter.`
            : t`This scene holds one moment still, so there is no part to pick. You can still make it longer or shorter.`}
        </p>
      )}
      <ExactTrim clip={clip} model={model} edits={edits} open={!part} />
    </section>
  );
}

interface PartControlProps extends Omit<ClipPartProps, 'actions'> {
  part: PartModel;
  detail: AssetDetail | null | undefined;
  onRetry(): void;
}

function PartControl({ part, clip, model, edits, lookup, detail, onRetry }: PartControlProps) {
  const { t } = useLingui();
  const editor = useEditorContext();
  const stripRef = useRef<HTMLDivElement>(null);
  const saysId = useId();
  const grid = useMemo(() => cutGrid(model), [model]);
  const locked = clip.item.locked;
  const gestures = usePartGestures({
    part,
    clipId: clip.item.id,
    edits,
    grid,
    disabled: locked || edits.pending,
    strip: stripRef,
  });
  const words = usePartWords(part, clip.number, grid !== null);
  const [hover, setHover] = useState<number | null>(null);
  const [said, setSaid] = useState('');

  const { from, to, gesture } = gestures;
  // This control's own change on its way: it waits without greying, as nothing here is in doubt.
  const busy = gestures.by === 'sent';
  const off = locked
    ? t`Unlock this scene to trim it`
    : edits.pending && !busy
      ? t`Wait for the current edit to finish`
      : undefined;
  const loading = detail === undefined;
  const frames = lookup.strip(part.assetId);
  const video = lookup.playback(part.assetId);
  const ratio = detail
    ? frameRatio(detail)
    : frames
      ? frames.filmstrip.tileWidth / frames.filmstrip.tileHeight
      : 9 / 16;
  const live = gesture !== null && !busy;
  // The last frame the scene shows, not the one after it.
  const last = Math.max(from, to - 1);
  const shown = gesture === 'end' ? last : gesture ? from : (hover ?? from);
  const player = usePartPlayer({
    src: video,
    fromMs: msAt(part, from),
    toMs: msAt(part, to),
    atMs: msAt(part, shown),
    muted: clip.item.audio.muted,
  });
  // The picture follows the hand while it drags.
  const held = gestures.by === 'pointer';
  useEffect(() => {
    if (held) player.stop();
  }, [held]);
  useEffect(() => {
    if (gestures.landed > 0) setSaid(words.landed(from, to));
  }, [gestures.landed]);

  const play = () => {
    // One thing plays at a time: the video stops for the part.
    if (!player.playing) editor?.playhead.pause();
    player.toggle();
  };
  const onKey = (which: PartGesture, event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      handled();
      gestures.step(which, event.key === 'ArrowRight' ? 1 : -1, event.shiftKey);
    } else if (which === 'move' && (event.key === 'Home' || event.key === 'End')) {
      handled();
      gestures.jump(event.key === 'Home' ? 'first' : 'last');
    } else if (event.key === 'Enter') {
      handled();
      gestures.settle();
    } else if (event.key === ' ') {
      handled();
      play();
    } else if (event.key === 'Escape' && gestures.cancel()) {
      handled();
    }
  };
  const picture =
    gesture === 'end'
      ? t`The last frame the scene would play`
      : hover !== null && !gesture
        ? t`The frame under the pointer`
        : t`The first frame the scene plays`;
  const canPlay = !!video && !player.failed;

  // One column where the tool is narrow (the strip first, then the monitor as a band); where there is room, the
  // monitor stands beside the rest. Inset by a grip's width, for the grips of a part at the clip's very ends.
  const beside = '@lg/part:col-start-2';
  return (
    <div className="grid gap-y-2 px-3 @lg/part:grid-cols-[auto_minmax(0,1fr)] @lg/part:gap-x-7 @lg/part:ps-0">
      <div className={beside}>
        <PartStrip
          part={part}
          gestures={gestures}
          frames={frames}
          ratio={ratio}
          disabled={off !== undefined}
          loading={loading}
          startEdge={part.before !== null}
          words={{
            move: words.slider('move', from, to),
            start: words.slider('start', from, to),
            end: words.slider('end', from, to),
          }}
          moving={live ? words.at(gesture === 'end' ? to : from) : null}
          stripRef={stripRef}
          onHover={setHover}
          onKey={onKey}
        />
      </div>
      <PartPicture
        label={picture}
        frames={frames}
        still={lookup.frameNow(part.assetId, part.shotId)?.url ?? null}
        atMs={msAt(part, shown)}
        ratio={ratio}
        videoSrc={video}
        player={player}
        loading={loading}
        className="h-24 w-full @lg/part:col-start-1 @lg/part:row-span-4 @lg/part:row-start-1 @lg/part:size-40"
      />
      <div className={cn(beside, 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1')}>
        <p data-slot="part-plays" className="m-0 type-body text-ink tabular-nums">
          {words.plays(from, to)}
        </p>
        <Button
          size="sm"
          variant="secondary"
          data-slot="part-play"
          aria-pressed={player.playing}
          disabled={!canPlay}
          title={canPlay || loading ? undefined : t`This clip has no copy to play yet`}
          icon={player.playing ? VERB_ICONS.pause : VERB_ICONS.play}
          onClick={play}
        >
          {player.playing ? t`Pause` : t`Play this part`}
        </Button>
      </div>
      <div className={beside}>
        <PartSteps
          off={off}
          describedBy={saysId}
          onStep={(direction, large) => gestures.step('move', direction, large)}
        />
      </div>
      <div className={beside}>
        <PartSays
          id={saysId}
          words={words}
          gestures={gestures}
          locked={locked}
          detail={detail}
          drawn={frames !== undefined}
          onRetry={onRetry}
        />
        <span role="status" className="sr-only">
          {said}
        </span>
      </div>
    </div>
  );
}

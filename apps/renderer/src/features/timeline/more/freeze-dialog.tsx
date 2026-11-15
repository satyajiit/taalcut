// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Freeze this moment (MORE1) · system: DESIGN.md v0.7
 * a dialog, because it adds a held moment to the video and asks one number: the frame under the playhead (the
 *   file's filmstrip frame nearest it, never decoded here; the shot's picture until that is there) with its time,
 *   the hold's length in seconds as a stepper, and one confirm (timeline.freezeFrame at the playhead). For a
 *   scene that already holds a moment it is "Change hold length" (timeline.setHoldDuration), starting from the
 *   length it has
 * states: ready · the playhead is outside the scene (said, and the confirm waits: the command would refuse) · a
 *   length no hold can have (said) · saving (the confirm spins) · refused (why, above the buttons, role="alert")
 * motion: the dialog's own pop; reduced motion: its fade
 */
import { useLingui } from '@lingui/react/macro';
import {
  dispatchReceiptSchema,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorResultSchema,
  type TimelineItemId,
} from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Glyph,
  Input,
  useTimecode,
  VERB_ICONS,
} from '@taalcut/ui';
import { useId, useMemo, useState } from 'react';
import { frameTimesMs, nearestFrame, useSpriteLoad } from '../../library/clip/scrubber/sprite';
import { coverStyle } from '../clip-part/cover-style';
import { msAt, partOf } from '../clip-part/part-model';
import { playedFrames } from '../clip-part/source-span';
import { fpsOf, mediaOf, type ClipView, type TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { SheetNote, useSheetSend } from './more-sheet';

/** The longest hold the stepper offers, and a step of the buttons beside it, in seconds. */
const MAX_SECONDS = 60;
const STEP = 0.5;

/** Milliseconds into its file of the frame the scene shows at canvas frame `frame`; null for a photo. */
function sourceMs(clip: ClipView, model: TimelineModel, frame: number): number | null {
  const hold = clip.item.holdFrame;
  if (hold) return (hold.value * 1000 * hold.rate.den) / hold.rate.num;
  const part = partOf(clip, model);
  if (!part) return null;
  return msAt(part, part.from + playedFrames(part.ramp, frame - clip.start) * part.perCanvas);
}

/** The frame the hold keeps, at the video's shape. */
function HeldFrame({ clip, model, lookup, frame, shape }: FreezeDialogProps & { frame: number }) {
  const media = mediaOf(clip.item);
  const frames = lookup.strip(media.assetId);
  const load = useSpriteLoad(frames?.src ?? null);
  const times = useMemo(() => (frames ? frameTimesMs(frames.filmstrip) : []), [frames]);
  const ms = sourceMs(clip, model, frame);
  const still = lookup.frameNow(media.assetId, media.shotId)?.url ?? null;
  const drawn = frames && load === 'ready' && times.length > 0 && ms !== null;
  return (
    <span
      data-slot="freeze-frame"
      className="block w-24 shrink-0 overflow-hidden rounded-md bg-viewer"
      style={{ aspectRatio: String(shape) }}
    >
      {drawn ? (
        <span
          className="block size-full"
          style={coverStyle(frames.filmstrip, frames.src, nearestFrame(times, ms), shape)}
        />
      ) : still ? (
        <img src={still} alt="" draggable={false} className="size-full object-cover" />
      ) : null}
    </span>
  );
}

export interface FreezeDialogProps {
  clip: ClipView;
  model: TimelineModel;
  lookup: ShotLookup;
  /** The video's shape, width over height. */
  shape: number;
  /** The playhead's frame when the dialog opened: the moment to freeze. */
  at: number;
  edits: Edits;
  onOpenChange(open: boolean): void;
  /** The change landed; `held` is the new held scene, when a moment was frozen. */
  onDone(held: TimelineItemId | null): void;
}

export function FreezeDialog(props: FreezeDialogProps) {
  const { clip, model, at, edits, onOpenChange, onDone } = props;
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const fieldId = useId();
  const noteId = useId();
  const held = !!clip.item.holdFrame;
  const fps = fpsOf(model.rate);
  const [seconds, setSeconds] = useState(() =>
    held ? Math.max(STEP, Math.round(((clip.end - clip.start) / fps) * 10) / 10) : 2,
  );
  const send = useSheetSend(edits, held ? String(clip.end - clip.start) : '');
  const saving = send.sending !== null;
  const inside = at >= clip.start && at < clip.end;
  const least = 1 / fps;
  const valid = Number.isFinite(seconds) && seconds >= least && seconds <= MAX_SECONDS;
  const n = i18n.number(clip.number);
  const clock = time.clock(held ? clip.start : at, model.rate);
  const most = i18n.number(MAX_SECONDS);
  const problem = !held && !inside ? 'outside' : !valid ? 'length' : null;
  const confirm = async () => {
    const duration = RationalTime.fromSeconds(seconds, model.rate);
    const done = await send.run('hold', () =>
      edits.command(held ? N.setHoldDuration : N.freezeFrame, {
        clipId: clip.item.id,
        duration,
        ...(!held ? { at: RationalTime.of(at, model.rate) } : {}),
      }),
    );
    if (!done.ok) return;
    const receipt = dispatchReceiptSchema.safeParse(done.value);
    const result = simpleEditorResultSchema.safeParse(receipt.success ? receipt.data.result : done.value);
    onDone(!held && result.success ? (result.data.itemId ?? null) : null);
    onOpenChange(false);
  };
  const step = (by: number) =>
    setSeconds((now) => Math.round(Math.min(MAX_SECONDS, Math.max(STEP, now + by)) * 10) / 10);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="freeze-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{held ? t`Change hold length` : t`Freeze this moment`}</DialogTitle>
          <DialogDescription>
            {held
              ? t`Scene ${n} holds one frame still. Set how long it stays.`
              : t`The picture stops on this frame and holds it, then the video plays on.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-4">
          <figure className="m-0 flex shrink-0 flex-col items-center gap-1.5">
            <HeldFrame {...props} frame={at} />
            <figcaption className="type-meta text-ink-2 tabular-nums">
              {held ? t`Held from ${clock}` : t`The frame at ${clock}`}
            </figcaption>
          </figure>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label htmlFor={fieldId} className="type-label text-ink">
              {t`Hold length (seconds)`}
            </label>
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="secondary"
                aria-label={t`Half a second shorter`}
                title={t`Half a second shorter`}
                disabled={saving || !(seconds - STEP >= STEP)}
                icon={VERB_ICONS.shorter}
                onClick={() => step(-STEP)}
              />
              <Input
                id={fieldId}
                type="number"
                inputMode="decimal"
                min={STEP / 5}
                max={MAX_SECONDS}
                step={0.1}
                value={Number.isFinite(seconds) ? seconds : ''}
                status={problem === 'length' ? 'error' : undefined}
                aria-describedby={noteId}
                className="w-20 text-center tabular-nums"
                onChange={(event) => setSeconds(event.target.value === '' ? NaN : Number(event.target.value))}
              />
              <Button
                size="icon"
                variant="secondary"
                aria-label={t`Half a second longer`}
                title={t`Half a second longer`}
                disabled={saving || !(seconds + STEP <= MAX_SECONDS)}
                icon={VERB_ICONS.longer}
                onClick={() => step(STEP)}
              />
            </div>
            <p
              id={noteId}
              data-slot="freeze-note"
              className="m-0 flex items-start gap-1.5 type-meta text-ink-2"
            >
              {problem ? <Glyph icon={CONCEPT_ICONS.info} size="sm" className="mt-px text-ink-3" /> : null}
              {problem === 'outside'
                ? t`The playhead is outside scene ${n}. Close this and move it to the moment you want.`
                : problem === 'length'
                  ? t`A hold lasts from one frame to ${most} seconds.`
                  : held
                    ? t`What follows moves to make room.`
                    : t`The held moment becomes its own scene, and what follows moves to make room.`}
            </p>
          </div>
        </div>
        <SheetNote refusal={send.refusal} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
          <Button
            variant="primary"
            data-slot="freeze-confirm"
            loading={saving}
            disabled={problem !== null}
            aria-describedby={noteId}
            onClick={() => void confirm()}
          >
            {held ? t`Change hold length` : t`Freeze this moment`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Make another size (MORE1) · system: DESIGN.md v0.7
 * a dialog, because it ends in a new video and not in a change to this one: the four sizes as cards drawn to
 *   their real shape with the video's own frame inside, each with where it is posted; one primary, "Make the 4:5
 *   copy" (timeline.makeSize); then, in the same dialog, that the copy is ready and "Open the new video"
 * states: choosing (the size the video already has is marked) · making (the primary spins, the cards wait) ·
 *   refused (why, above the buttons, role="alert") · made (the copy's shape, Open the new video, Stay here)
 * motion: the dialog's own pop; reduced motion: its fade
 */
import { useLingui } from '@lingui/react/macro';
import {
  dispatchReceiptSchema,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorResultSchema,
  VIDEO_SIZES,
  type TimelineId,
  type VideoAspect,
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
} from '@taalcut/ui';
import { useId, useState } from 'react';
import type { Edits } from '../use-edits';
import { ChoiceCards } from './choice-cards';
import { SheetNote, useSheetSend } from './more-sheet';
import { SIZE_USES } from './more-words';

const ASPECTS = Object.keys(VIDEO_SIZES) as VideoAspect[];

/** A size drawn to its real shape, as tall or as wide as `box` px, with the video's frame inside. */
function Shape({ aspect, still, box }: { aspect: VideoAspect; still: string | null; box: number }) {
  const { width, height } = VIDEO_SIZES[aspect];
  const scale = box / Math.max(width, height);
  return (
    <span className="flex items-center justify-center" style={{ height: box }}>
      <span
        data-slot="size-shape"
        data-aspect={aspect}
        className="block overflow-hidden rounded-sm bg-viewer ring-1 ring-rule"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      >
        {still ? <img src={still} alt="" draggable={false} className="size-full object-cover" /> : null}
      </span>
    </span>
  );
}

export interface SizeDialogProps {
  /** The size the video has now; null for a canvas that is none of the four. */
  current: VideoAspect | null;
  /** A frame of the video, to draw inside each shape. */
  still: string | null;
  edits: Edits;
  onOpenChange(open: boolean): void;
  onVideo(id: TimelineId): void;
}

export function SizeDialog({ current, still, edits, onOpenChange, onVideo }: SizeDialogProps) {
  const { t, i18n } = useLingui();
  const noteId = useId();
  const [aspect, setAspect] = useState<VideoAspect>(() => ASPECTS.find((choice) => choice !== current)!);
  const [made, setMade] = useState<{ id: TimelineId; aspect: VideoAspect } | null>(null);
  const send = useSheetSend(edits, made?.id ?? '');
  const making = send.sending !== null;
  const madeAspect = made?.aspect;
  const make = async () => {
    const done = await send.run(aspect, () => edits.command(N.makeSize, { aspect }));
    if (!done.ok) return;
    const receipt = dispatchReceiptSchema.safeParse(done.value);
    const result = simpleEditorResultSchema.safeParse(receipt.success ? receipt.data.result : done.value);
    if (result.success) setMade({ id: result.data.timelineId, aspect });
  };
  return (
    // Mounted only while it is open, so the kit's dialog knows the tile that opened it and gives focus back.
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="size-dialog" className="max-w-xl">
        {made ? (
          <>
            <DialogHeader>
              <DialogTitle>{t`The ${madeAspect} copy is ready`}</DialogTitle>
              <DialogDescription>{t`It is its own video now. This one stays as it is.`}</DialogDescription>
            </DialogHeader>
            <div
              className="flex items-center gap-4 rounded-lg bg-well p-4"
              role="status"
              data-slot="size-made"
            >
              <Shape aspect={made.aspect} still={still} box={96} />
              <p className="m-0 flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 type-card-title text-ink tabular-nums">
                  <Glyph icon={CONCEPT_ICONS.success} className="text-success-strong" />
                  {made.aspect}
                </span>
                <span className="type-meta text-ink-2">{i18n._(SIZE_USES[made.aspect])}</span>
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t`Stay here`}</Button>
              <Button
                autoFocus
                variant="primary"
                data-slot="size-open"
                onClick={() => {
                  onOpenChange(false);
                  onVideo(made.id);
                }}
              >
                {t`Open the new video`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t`Make another size`}</DialogTitle>
              <DialogDescription>
                {t`Creates an independent video copy. Your original stays as it is.`}
              </DialogDescription>
            </DialogHeader>
            <ChoiceCards<VideoAspect>
              label={t`Size`}
              slot="size-choices"
              value={aspect}
              off={making}
              describedBy={noteId}
              className="grid-cols-2 sm:grid-cols-4"
              options={ASPECTS.map((choice) => ({
                value: choice,
                label: choice,
                detail: i18n._(SIZE_USES[choice]),
                badge: choice === current ? t`Now` : undefined,
                picture: <Shape aspect={choice} still={still} box={88} />,
              }))}
              onPick={setAspect}
            />
            <SheetNote id={noteId} refusal={send.refusal} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
              <Button variant="primary" data-slot="size-make" loading={making} onClick={() => void make()}>
                {t`Make the ${aspect} copy`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

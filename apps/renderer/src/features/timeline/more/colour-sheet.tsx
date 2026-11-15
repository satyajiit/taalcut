// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the colour sheet (MORE1) · system: DESIGN.md v0.7 (Footage First)
 * a scene's colour, judged by eye in the lower panel while the viewer above shows the scene: on one side the
 *   looks as cards, each the scene's own frame as that look would leave it (with the adjustments already made);
 *   on the other Brightness, Warmth and Colour strength, each saying its value in words, with Reset adjustments
 *   (keeps the look) and "Back to the colour as shot" (clears everything) once there is something to undo. Every
 *   change is one edit (timeline.setGrade), a slider's on release
 * states: the cards' own (choice-cards.tsx) · a slider moving (the swatches and the chip follow before it is
 *   saved) · a change on its way (the sliders keep working: a key held down is a run of edits) · refused (why,
 *   under the looks; the sliders go back) · as shot (no reset to offer; pressing a way back moves focus to the
 *   look in use) · the scene locked or the AI editing (everything reads but waits, and the line says which)
 * motion: the sheet's arrival; nothing of its own
 */
import { useLingui } from '@lingui/react/macro';
import { GRADE_LOOKS, NEUTRAL_GRADE, type Grade, type GradeLook, type GradePatch } from '@taalcut/core';
import { Button, cn } from '@taalcut/ui';
import { RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { editorOps } from '../edit-ops';
import { ChoiceCards } from './choice-cards';
import { GradePicture } from './grade-picture';
import { GradeSlider } from './grade-slider';
import { MoreSheet, SheetNote, useSheetSend } from './more-sheet';
import {
  adjustmentWords,
  GRADE_ADJUSTMENTS,
  gradeWords,
  LOOK_WORDS,
  type GradeAdjustment,
} from './more-words';
import type { SceneSheetProps } from './speed-sheet';

/**
 * The looks: three across in the detailed timeline's narrow panel, one strip that scrolls sideways in a middling
 * one (the room around it is for a card's focus ring), five across beside the adjustments in a wide one.
 */
const LOOKS = cn(
  'grid-cols-3 gap-1.5 [&>[role=radio]]:p-1',
  '@lg:-my-1 @lg:-ms-1 @lg:flex @lg:overflow-x-auto @lg:p-1',
  '@lg:[&>[role=radio]]:w-18 @lg:[&>[role=radio]]:shrink-0',
  '@xl:m-0 @xl:grid @xl:grid-cols-5 @xl:overflow-visible @xl:p-0 @xl:[&>[role=radio]]:w-auto',
);

/**
 * The adjustments and their reset: stacked in the narrow panel and beside the looks in a wide one (the reset
 * under the sliders, with its words); in a middling one the sliders are three across with the reset at the row's
 * end as its glyph alone, so it costs no row of its own (the lower panel at 960 × 600 has none to spare).
 */
const ADJUSTMENTS = cn(
  'flex min-w-0 flex-col gap-2',
  '@lg:flex-row @lg:items-end @lg:gap-3 @xl:flex-col @xl:items-stretch @xl:gap-2',
);
const RESET = cn(
  '-ms-3 self-start',
  '@lg:ms-0 @lg:w-8 @lg:self-end @lg:px-0 @xl:-ms-3 @xl:w-auto @xl:self-start @xl:px-3',
);

type LookChoice = GradeLook | 'none';
const LOOK_CHOICES: readonly LookChoice[] = ['none', ...GRADE_LOOKS];

export interface ColourSheetProps extends SceneSheetProps {
  /** The scene's own frame, for the swatches; null while it loads. */
  still: string | null;
  /** The whole video's grade, drawn on top of the scene's. */
  videoGrade: Partial<Grade> | undefined;
}

export function ColourSheet({ clip, model, edits, off, still, videoGrade, onClose }: ColourSheetProps) {
  const { t, i18n } = useLingui();
  const noteId = useId();
  const ops = editorOps(edits, model.rate);
  const id = clip.item.id;
  const stored = clip.item.grade;
  const saved = JSON.stringify(stored ?? null);
  // What a slider shows while it moves, before it is saved: the swatches and the chip follow the hand, until the
  // timeline brings the saved grade (or the save is refused, and the sliders go back).
  const [draft, setDraft] = useState<Partial<Record<GradeAdjustment, number>>>({});
  const [refusals, setRefusals] = useState(0);
  useEffect(() => setDraft({}), [saved]);
  const grade: Grade = { ...NEUTRAL_GRADE, ...stored, ...draft };
  const look: LookChoice = grade.look ?? 'none';
  const send = useSheetSend(edits, saved);
  const waits = off !== null;
  const setGrade = async (key: string, patch: GradePatch | null) => {
    const done = await send.run(key, () => ops.grade({ clipIds: [id] }, patch));
    if (done.ok) return;
    setDraft({});
    setRefusals((count) => count + 1);
  };
  // A way back that has done its work leaves the sheet (nothing is left to undo): focus goes to the look in use,
  // never to nowhere.
  const looks = useRef<HTMLDivElement>(null);
  const undo = (key: string, patch: GradePatch | null) => {
    void setGrade(key, patch);
    looks.current?.querySelector<HTMLElement>('[role=radio][tabindex="0"]')?.focus();
  };
  const adjusted = GRADE_ADJUSTMENTS.some((key) => (stored?.[key] ?? 0) !== 0);
  const labels: Readonly<Record<GradeAdjustment, string>> = {
    exposure: t`Brightness`,
    temperature: t`Warmth`,
    saturation: t`Colour strength`,
  };
  return (
    <MoreSheet
      id="colour"
      family="picture"
      picture={<GradePicture still={still} grade={grade} videoGrade={videoGrade} className="size-full" />}
      title={t`Colour`}
      value={gradeWords(i18n, grade)}
      action={
        stored ? (
          <Button
            size="sm"
            variant="secondary"
            data-slot="clip-colour-clear"
            disabled={waits}
            onClick={() => undo('clear', null)}
          >
            {t`Back to the colour as shot`}
          </Button>
        ) : null
      }
      onClose={onClose}
    >
      <div className="grid gap-x-5 gap-y-3 @xl:grid-cols-[minmax(0,13fr)_minmax(0,8fr)]">
        <div ref={looks} className="flex min-w-0 flex-col gap-2">
          <ChoiceCards
            label={t`Colour look`}
            slot="clip-look"
            value={look}
            sending={LOOK_CHOICES.includes(send.sending as LookChoice) ? (send.sending as LookChoice) : null}
            off={waits}
            describedBy={off !== null || send.refusal ? noteId : undefined}
            sideways
            className={LOOKS}
            options={LOOK_CHOICES.map((choice) => ({
              value: choice,
              label: i18n._(LOOK_WORDS[choice]),
              picture: (
                <GradePicture
                  still={still}
                  grade={{ ...grade, look: choice === 'none' ? null : choice }}
                  videoGrade={videoGrade}
                  className="aspect-[3/2] w-full rounded-sm"
                />
              ),
            }))}
            onPick={(choice) => void setGrade(choice, { look: choice === 'none' ? null : choice })}
          />
          <SheetNote id={noteId} refusal={send.refusal}>
            {off}
          </SheetNote>
        </div>
        <div className={ADJUSTMENTS}>
          <div
            className="grid min-w-0 flex-1 gap-x-4 gap-y-1 @lg:grid-cols-3 @xl:grid-cols-1"
            data-slot="clip-colour"
          >
            {GRADE_ADJUSTMENTS.map((key) => (
              <GradeSlider
                key={key}
                slot={`clip-${key}`}
                label={labels[key]}
                value={stored?.[key] ?? 0}
                words={(value) => adjustmentWords(i18n, key, value) ?? t`As shot`}
                disabled={waits}
                version={refusals}
                onDraft={(value) => setDraft((before) => ({ ...before, [key]: value }))}
                onCommit={(value) => void setGrade(key, { [key]: value })}
              />
            ))}
          </div>
          {adjusted ? (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              data-slot="clip-colour-reset"
              title={t`Reset adjustments`}
              className={RESET}
              disabled={waits}
              onClick={() => undo('reset', { exposure: 0, temperature: 0, saturation: 0 })}
            >
              <span className="@lg:sr-only @xl:not-sr-only">{t`Reset adjustments`}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </MoreSheet>
  );
}

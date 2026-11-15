// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the speed and transition sheets (MORE1) · system: DESIGN.md v0.7
 * two choices judged by eye, each a row of drawn cards in the lower panel (more-sheet.tsx) while the viewer
 *   above shows the scene: Speed, seven speeds from a quarter to four times, each drawn as how closely its ticks
 *   sit (sky, time); Transition, a plain cut or one of six ways into the next scene, each drawn as what happens
 *   between the two frames (orchid, the join). A pick is one edit (timeline.setSpeed; timeline.setTransition or timeline.removeTransition), one
 *   undo step
 * states: the cards' own (choice-cards.tsx) · a pick on its way · refused (why, under the cards) · the scene
 *   locked, the AI editing or another edit on its way (the cards read but wait, and the line says which)
 * motion: the sheet's arrival; nothing of their own
 */
import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS } from '@taalcut/ui';
import { useId } from 'react';
import {
  editorOps,
  SPEED_CHOICES,
  speedOf,
  TRANSITION_CHOICES,
  transitionAfter,
  transitionChoice,
  type TransitionChoice,
} from '../edit-ops';
import type { ClipView, TimelineModel } from '../model';
import type { Edits } from '../use-edits';
import { ChoiceCards } from './choice-cards';
import { MoreSheet, SheetNote, useSheetSend } from './more-sheet';
import { speedFigure, speedWords, TRANSITION_WORDS } from './more-words';
import { SpeedMotif, TransitionMotif } from './motifs';

export interface SceneSheetProps {
  clip: ClipView;
  model: TimelineModel;
  edits: Edits;
  /** Why the scene can't be changed right now, in words; its controls read but wait. */
  off: string | null;
  onClose(): void;
}

/** Enough room for a card's drawing and its word, as many to a row as fit; the drawing gets a little air. */
const CARD_ROW = 'grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] [&>[role=radio]]:py-3';

export function SpeedSheet({ clip, model, edits, off, onClose }: SceneSheetProps) {
  const { t, i18n } = useLingui();
  const noteId = useId();
  const ops = editorOps(edits, model.rate);
  const speed = speedOf(clip);
  const send = useSheetSend(edits, String(speed));
  return (
    <MoreSheet
      id="speed"
      family="time"
      icon={CONCEPT_ICONS.speed}
      title={t`Speed`}
      value={speedWords(i18n, speed)}
      onClose={onClose}
    >
      <ChoiceCards
        label={t`Speed`}
        slot="clip-speed"
        value={String(speed)}
        sending={send.sending}
        off={off !== null}
        describedBy={noteId}
        className={CARD_ROW}
        options={SPEED_CHOICES.map((choice) => ({
          value: String(choice),
          label: speedFigure(i18n, choice),
          picture: <SpeedMotif speed={choice} className="h-7 text-sky-strong" />,
        }))}
        onPick={(choice) => void send.run(choice, () => ops.speed(clip.item.id, Number(choice)))}
      />
      <SheetNote id={noteId} refusal={send.refusal}>
        {off ?? t`The scene keeps what it shows: faster makes it shorter, slower makes it longer.`}
      </SheetNote>
    </MoreSheet>
  );
}

export function TransitionSheet({ clip, model, edits, off, onClose }: SceneSheetProps) {
  const { t, i18n } = useLingui();
  const noteId = useId();
  const ops = editorOps(edits, model.rate);
  const kind = transitionChoice(transitionAfter(model, clip));
  const send = useSheetSend(edits, kind);
  const [from, to] = [i18n.number(clip.number), i18n.number(clip.number + 1)];
  return (
    <MoreSheet
      id="transition"
      family="join"
      picture={<TransitionMotif kind={kind} className="h-auto w-6" />}
      title={t`Transition`}
      value={i18n._(TRANSITION_WORDS[kind])}
      onClose={onClose}
    >
      <ChoiceCards
        label={t`Transition`}
        slot="clip-transition"
        value={kind}
        sending={send.sending as TransitionChoice | null}
        off={off !== null}
        describedBy={noteId}
        className={CARD_ROW}
        options={TRANSITION_CHOICES.map((choice) => ({
          value: choice,
          label: i18n._(TRANSITION_WORDS[choice]),
          picture: <TransitionMotif kind={choice} className="text-orchid-strong" />,
        }))}
        onPick={(choice) => void send.run(choice, () => ops.transition(clip.item.id, choice))}
      />
      <SheetNote id={noteId} refusal={send.refusal}>
        {off ?? t`How scene ${from} goes into scene ${to}.`}
      </SheetNote>
    </MoreSheet>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4
 * Hallmark · component: changes card (EDT1-CTX) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · a review card: hairline frame, no icon · "What changed", then one row per change, in
 *   the editor's own words ("Clip 3: 2.4s → 1.8s"); the before is ink-2, the arrow ink-3, the after ink; words the
 *   user or the agent wrote are content (never translated). Each row is a button: it selects its item in the editor
 *   and moves the playhead there. Undo all takes the whole turn back as one step; Keep folds the buttons away
 * states: applied (Undo all, Keep) · undone (neutral chip, Redo) · later (a quiet line: later changes sit on top) ·
 *   kept (success chip) · unknown (no buttons while the history loads) · loading (the chosen button spins) · error
 *   (the cause under the buttons, the buttons stay) · each row hover, focus (ring), active (pressed wash)
 * motion: none of its own; Button's states
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, EditChangeRow } from '@taalcut/core';
import { Chip } from '../components/badge';
import { Button } from '../components/button';
import { VERB_ICONS } from '../icons/concepts';
import { useTimecode } from '../make/timecode';
import { useCardActions, type EditTurnStatus } from './card-actions';
import { CardFrame, UserContent } from './card-frame';
import { changeLine, changeTarget, changeWords, designParts } from './edit-change-words';

type Card = CardOf<'editChanges'>;

const noStatus = (): EditTurnStatus => 'unknown';

interface RowProps {
  readonly row: EditChangeRow;
  readonly onOpen?: (() => void) | undefined;
  /** HFW1-UI: a design row's View files. */
  readonly onFiles?: (() => void) | undefined;
}

function Row({ row, onOpen, onFiles }: RowProps) {
  const { i18n } = useLingui();
  const time = useTimecode();
  const name = changeTarget(i18n, row);
  const what = changeWords(i18n, time, row.change);
  const isWords = row.change.kind === 'words';
  const content =
    row.change.kind === 'design' ? (
      <DesignWords change={row.change} />
    ) : typeof what === 'string' ? (
      <span>
        {row.change.kind === 'setting' ? (
          what
        ) : (
          <Trans>
            {name}: {what}
          </Trans>
        )}
      </span>
    ) : (
      <span className="[overflow-wrap:anywhere]">
        <span className="font-medium">{name}</span>
        <span aria-hidden>: </span>
        <span className="text-ink-2">
          {isWords ? <UserContent>“{what.before}”</UserContent> : what.before}
        </span>
        <span aria-hidden className="text-ink-3">
          {' → '}
        </span>
        <span>{isWords ? <UserContent>“{what.after}”</UserContent> : what.after}</span>
      </span>
    );
  const label = changeLine(i18n, time, row);
  const files = onFiles ? <ViewFiles label={label} onClick={onFiles} /> : null;
  if (!onOpen)
    return (
      <li className="flex items-center gap-1">
        <span className="min-w-0 flex-1 type-body px-2 py-1">{content}</span>
        {files}
      </li>
    );
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-label={label}
        onClick={onOpen}
        className="min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1 text-start type-body outline-hidden transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
      >
        {content}
      </button>
      {files}
    </li>
  );
}

/** "Chat bubble · new design v1 → v2 · proposed": the design's name as the model wrote it, then what happened. */
function DesignWords({ change }: { change: Extract<EditChangeRow['change'], { kind: 'design' }> }) {
  const { i18n } = useLingui();
  const { name, what } = designParts(i18n, change);
  return (
    <span className="[overflow-wrap:anywhere]">
      <UserContent translate="no" className="font-medium">
        {name}
      </UserContent>
      <span aria-hidden className="text-ink-3">
        {' · '}
      </span>
      <span className="text-ink-2">{what}</span>
    </span>
  );
}

/** A design row's View files: the editor's Files tab on that graphic's design. */
function ViewFiles({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLingui();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={VERB_ICONS.viewFiles}
      className="shrink-0"
      aria-label={t`View files: ${label}`}
      onClick={onClick}
    >
      {t`View files`}
    </Button>
  );
}

/**
 * The AI's changes in one turn (EDT1-CTX): each in plain words with its before and after, each opening its item in
 * the editor. Step undo/redo lives in the editor's History / Versions panel and ⌘Z, so applied edit cards settle
 * cleanly in chat without repetitive per-card Undo/Keep buttons.
 */
export function EditChangesCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const { editTurn } = useCardActions();
  const useStatus = editTurn?.useStatus ?? noStatus;
  const status = useStatus(card.projectId, card.group);
  const more = i18n.number(card.more);
  const chip = status === 'undone' ? <Chip tone="neutral">{t`Undone`}</Chip> : null;
  return (
    <CardFrame cardType="editChanges" data-status={status} title={t`What changed`} aside={chip}>
      {card.changes.length === 0 ? (
        <p className="m-0 type-body text-ink-2">
          <Trans>Nothing on the timeline changed.</Trans>
        </p>
      ) : (
        <ul aria-label={t`Changes`} className="-mx-2 m-0 flex list-none flex-col p-0">
          {card.changes.map((row, index) => (
            <Row
              key={`${row.target.kind}:${index}`}
              row={row}
              onOpen={
                editTurn && status !== 'undone'
                  ? () => editTurn.open(card.projectId, row.target, row.at)
                  : undefined
              }
              onFiles={
                row.change.kind === 'design' && editTurn?.openFiles
                  ? () => editTurn.openFiles?.(card.projectId, row.target)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {card.more > 0 ? <p className="m-0 type-meta text-ink-2">{t`And ${more} more.`}</p> : null}
      {status === 'undone' ? (
        <p className="m-0 type-meta text-ink-2">
          <Trans>This step was undone in History.</Trans>
        </p>
      ) : null}
    </CardFrame>
  );
}

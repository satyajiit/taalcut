// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: an overlay's graphic brief, read as a motion designer would (DSG1-READ) · system:
 *   DESIGN.md v0.7 (violet: the AI's reading; teal: yours)
 * how Taalcut read one of the reel's graphics: what it is and its part in the story (two chips and Taalcut's words),
 *   then its look, its motion, what it is timed to and where it sits by the people, as a short list. Led by the AI
 *   mark when Taalcut wrote it and "You" when you did. Edit opens the brief's fields in place (template.graphic.edit);
 *   Not a graphic leaves it out of made videos (template.graphic.set). A reading Taalcut took for footage (a sign, a
 *   shop front) shows as removed, with its reason and Restore. Taalcut's words are the model's: plain text, never
 *   translated
 * states: default · editing (the fields, Save and Cancel) · saving (Save spins) · removed (the reason, Restore) ·
 *   setting (Not a graphic or Restore spins) · busy (another fix on its way) · read-only (no buttons)
 * contrast: the list's labels are ink-2 on the panel (4.5:1 in both themes); words are ink
 */
import { useLingui } from '@lingui/react/macro';
import type { GraphicBrief, GraphicBriefKind, GraphicBriefPatch, GraphicStoryRole } from '@taalcut/core';
import { useEffect, useId, useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { Select } from '#components/select';
import { UserContent } from '../cards/card-frame';
import {
  GRAPHIC_KIND_WORDS,
  GRAPHIC_KINDS_LISTED,
  GRAPHIC_ROLE_WORDS,
  GRAPHIC_ROLES_LISTED,
} from './graphic-words';
import { REVIEW_ICONS } from './review-icons';

export interface GraphicBriefViewProps {
  brief: GraphicBrief;
  /** Not a graphic (false) or Restore (true); undefined: read-only. */
  onSet?: ((graphic: boolean) => void) | undefined;
  /** Saves the person's brief; resolves true when it was kept. Undefined: read-only. */
  onEdit?: ((patch: GraphicBriefPatch) => Promise<boolean>) | undefined;
  /** Not a graphic or Restore is on its way. */
  setting: boolean;
  /** The brief's edit is on its way. */
  saving: boolean;
  /** Another fix is on its way. */
  busy: boolean;
}

const FIELD =
  'w-full resize-y rounded-md border border-rule-strong bg-raised px-2 py-1 type-meta text-ink shadow-xs hover:border-ink-3 focus:border-ink-2 focus:bg-canvas';

type Draft = {
  kind: GraphicBriefKind;
  role: GraphicStoryRole;
  what: string;
  look: string;
  motion: string;
  timing: string;
  people: string;
};
const draftOf = (brief: GraphicBrief): Draft => ({
  kind: brief.kind,
  role: brief.role,
  what: brief.what,
  look: brief.look.words,
  motion: brief.motion.words,
  timing: brief.timing.words,
  people: brief.people.words,
});

/** Only what the person changed, so the brief keeps the rest as Taalcut read it. */
function patchOf(brief: GraphicBrief, draft: Draft): GraphicBriefPatch | null {
  const before = draftOf(brief);
  const patch = Object.fromEntries(
    (Object.keys(draft) as (keyof Draft)[])
      .filter((key) => draft[key].trim() !== before[key].trim())
      .map((key) => [key, draft[key].trim()]),
  ) as GraphicBriefPatch;
  return Object.keys(patch).length > 0 ? patch : null;
}

function BriefForm({
  brief,
  saving,
  onSave,
  onCancel,
}: {
  brief: GraphicBrief;
  saving: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(brief));
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((now) => ({ ...now, [key]: event.target.value }));
  const words: { key: 'look' | 'motion' | 'timing' | 'people'; label: string; max: number }[] = [
    { key: 'look', label: t`Look`, max: 300 },
    { key: 'motion', label: t`Motion`, max: 200 },
    { key: 'timing', label: t`Timing`, max: 200 },
    { key: 'people', label: t`By the people`, max: 200 },
  ];
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 type-label-sm text-ink-2">
          {t`What it is`}
          <Select value={draft.kind} onChange={set('kind')}>
            {GRAPHIC_KINDS_LISTED.map((kind) => (
              <option key={kind} value={kind}>
                {i18n._(GRAPHIC_KIND_WORDS[kind])}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 type-label-sm text-ink-2">
          {t`Part in the story`}
          <Select value={draft.role} onChange={set('role')}>
            {GRAPHIC_ROLES_LISTED.map((role) => (
              <option key={role} value={role}>
                {i18n._(GRAPHIC_ROLE_WORDS[role])}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label htmlFor={`${id}-what`} className="type-label-sm text-ink-2">
        {t`In a few words`}
      </label>
      <Input id={`${id}-what`} value={draft.what} maxLength={200} onChange={set('what')} className="h-8" />
      {words.map(({ key, label, max }) => (
        <label key={key} className="flex flex-col gap-1 type-label-sm text-ink-2">
          {label}
          <textarea value={draft[key]} maxLength={max} rows={2} onChange={set(key)} className={FIELD} />
        </label>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving}>
          {t`Save`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t`Cancel`}
        </Button>
      </div>
    </form>
  );
}

export function GraphicBriefView({ brief, onSet, onEdit, setting, saving, busy }: GraphicBriefViewProps) {
  const { t, i18n } = useLingui();
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [brief]);
  const Removed = REVIEW_ICONS.notGraphic;
  if (!brief.graphic)
    return (
      <div data-slot="graphic-brief" data-removed className="flex flex-col gap-1.5">
        <p className="m-0 flex items-start gap-1.5 type-meta text-ink">
          <Removed aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-2" />
          <span>
            {t`Not a graphic: footage the reel filmed. Videos made from this template leave it out.`}
            {brief.reason ? (
              <UserContent translate="no" className="block text-ink-2">
                {brief.reason}
              </UserContent>
            ) : null}
          </span>
        </p>
        {onSet ? (
          <div className="flex gap-2 ps-5">
            <Button
              size="sm"
              variant="ghost"
              icon={REVIEW_ICONS.restore}
              loading={setting}
              disabled={busy}
              onClick={() => onSet(true)}
            >
              {t`Restore as a graphic`}
            </Button>
          </div>
        ) : null}
      </div>
    );
  const rows = [
    { label: t`Look`, words: brief.look.words },
    { label: t`Motion`, words: brief.motion.words },
    { label: t`Timing`, words: brief.timing.words },
    { label: t`By the people`, words: brief.people.words },
  ].filter((row) => row.words.length > 0);
  return (
    <div data-slot="graphic-brief" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {brief.source === 'person' ? (
          <Chip tone="you">{t`You`}</Chip>
        ) : (
          <AiMark className="size-3.5 shrink-0" label={t`Taalcut’s reading`} />
        )}
        <Chip>{i18n._(GRAPHIC_KIND_WORDS[brief.kind])}</Chip>
        <Chip>{i18n._(GRAPHIC_ROLE_WORDS[brief.role])}</Chip>
        <UserContent translate="no" className="min-w-0 type-meta text-ink">
          {brief.what}
        </UserContent>
      </div>
      {editing && onEdit ? (
        <BriefForm
          brief={brief}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={(draft) => {
            const patch = patchOf(brief, draft);
            if (!patch) return setEditing(false);
            void onEdit(patch).then((kept) => kept && setEditing(false));
          }}
        />
      ) : (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 type-meta">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-ink-2">{row.label}</dt>
              <dd className="m-0 text-ink">
                <UserContent translate="no">{row.words}</UserContent>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!editing && (onEdit || onSet) ? (
        <div className="flex flex-wrap gap-2">
          {onEdit ? (
            <Button
              size="sm"
              variant="ghost"
              icon={REVIEW_ICONS.describe}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {t`Edit the brief`}
            </Button>
          ) : null}
          {onSet ? (
            <Button
              size="sm"
              variant="secondary"
              icon={REVIEW_ICONS.notGraphic}
              loading={setting}
              disabled={busy}
              onClick={() => onSet(false)}
            >
              {t`Not a graphic`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: hub structure in words (/templates/hub/$hubId) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 · what the template asks for, read top to bottom: each slot as a hairline
 *   row (number, its role as a kind chip: the hook coral, the peak orchid, the ending sky; length, shot and camera,
 *   the author's words), then the text pattern (which box, over which slot, how long its words were), unboxed on the
 *   canvas; each heading led by its icon (UX3)
 * states: n/a (static text; the rows have no actions)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { HubTemplateV0 } from '@taalcut/core';
import { MOTION_LABELS, RoleChip, SHOT_TYPE_LABELS, UserContent, toSeconds } from '@taalcut/ui';
import { Layers, Type } from 'lucide-react';
import { formatSeconds } from '../../shared/format';

type Structure = HubTemplateV0['structure'];

type TextRole = Structure['text'][number]['role'];

export function HubSlots({ structure }: { readonly structure: Structure }) {
  const { t, i18n } = useLingui();
  return (
    <section aria-labelledby="hub-slots" className="flex flex-col gap-2">
      <h2 id="hub-slots" className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
        <Layers aria-hidden className="size-5 text-ink-3" />
        {t`Slots`}
      </h2>
      <ol className="m-0 flex list-none flex-col p-0">
        {structure.slots.map((slot, index) => {
          const number = i18n.number(index + 1);
          const length = formatSeconds(i18n, toSeconds(slot.duration));
          const what = [
            slot.intent.shotType ? i18n._(SHOT_TYPE_LABELS[slot.intent.shotType]) : null,
            slot.intent.motion ? i18n._(MOTION_LABELS[slot.intent.motion]) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={index}
              data-hub-slot={index}
              className="grid grid-cols-[2rem_1fr] gap-x-3 gap-y-0.5 border-b border-rule-subtle py-2.5 last:border-b-0"
            >
              <span className="row-span-2 text-md font-semibold text-ink tabular-nums">{number}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2 tabular-nums">
                <RoleChip role={slot.role} />
                <span>{length}</span>
                {what ? <span>{what}</span> : null}
              </span>
              <UserContent translate="no" className="text-sm text-ink">
                {slot.intent.text}
              </UserContent>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function HubTextPattern({ structure }: { readonly structure: Structure }) {
  const { t, i18n } = useLingui();
  if (structure.text.length === 0) return null;
  const words: Readonly<Record<TextRole, string>> = {
    title: t`Title`,
    label: t`Label`,
    list: t`List`,
    caption: t`Caption`,
    cta: t`Call to action`,
    other: t`Text`,
  };
  return (
    <section aria-labelledby="hub-text" className="flex flex-col gap-2">
      <h2 id="hub-text" className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
        <Type aria-hidden className="size-5 text-ink-3" />
        {t`Text on screen`}
      </h2>
      <p className="m-0 text-sm text-ink-2">{t`Where text goes and how long it was. The words are yours to write.`}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {structure.text.map((overlay, index) => {
          const slot = overlay.slotIndex === null ? null : i18n.number(overlay.slotIndex + 1);
          const count = overlay.words;
          const role = words[overlay.role];
          return (
            <li key={index} className="text-sm text-ink">
              {slot === null
                ? t`${role}, about ${plural(count, { one: '# word', other: '# words' })}`
                : t`${role} over slot ${slot}, about ${plural(count, { one: '# word', other: '# words' })}`}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

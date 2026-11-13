// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: text overlays lane · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the reference's on-screen text as neutral marks on the same time axis as the slots, then the words themselves
 *   in time order (OCR of the reference: untrusted, shown as written, never translated)
 * states: default · lit (the text in the slot under the pointer or selected: ink, the rest ink-3) · n/a otherwise
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { Id, Template } from '@taalcut/core';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { toSeconds } from './slot-words';

const ROLE_WORDS: Readonly<Record<Template['text'][number]['role'], MessageDescriptor>> = {
  title: msg`Title`,
  label: msg`Label`,
  list: msg`List`,
  caption: msg`Caption`,
  cta: msg`Call to action`,
  other: msg`Text`,
};

export interface OverlaysLaneProps {
  template: Template;
  litSlot: Id<'TemplateSlot'> | null;
  /** The marks on the time axis (under the slots), or the words in time order. */
  show: 'marks' | 'list';
  className?: string;
}

export function OverlaysLane({ template, litSlot, show, className }: OverlaysLaneProps) {
  const { t, i18n } = useLingui();
  const total = toSeconds(template.duration) || 1;
  if (template.text.length === 0) return null;
  return (
    <div data-slot="overlays-lane" data-show={show} className={cn('flex flex-col gap-2', className)}>
      {show === 'marks' ? (
        <div aria-hidden className="relative h-1.5">
          {template.text.map((item) => (
            <span
              key={item.id}
              className={cn(
                'absolute top-0 h-1.5 rounded-pill px-px transition-colors duration-(--dur-micro) ease-(--ease-out)',
                item.slotId === litSlot ? 'bg-ink-2' : 'bg-rule-strong',
              )}
              style={{
                left: `${(toSeconds(item.start) / total) * 100}%`,
                width: `max(0.375rem, ${(toSeconds(item.duration) / total) * 100}%)`,
              }}
            />
          ))}
        </div>
      ) : (
        <ul aria-label={t`Text on screen`} className="m-0 flex list-none flex-col gap-1 p-0">
          {template.text.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-baseline gap-3 text-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                litSlot === null || item.slotId === litSlot ? 'text-ink' : 'text-ink-3',
              )}
            >
              <span className="min-w-12 shrink-0 text-xs text-ink-3 tabular-nums">
                {i18n.number(toSeconds(item.start), {
                  style: 'unit',
                  unit: 'second',
                  unitDisplay: 'narrow',
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </span>
              <span className="w-28 shrink-0 text-xs text-ink-2">{i18n._(ROLE_WORDS[item.role])}</span>
              <UserContent translate="no" lang={item.language ?? undefined} className="min-w-0 font-medium">
                {item.text}
              </UserContent>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

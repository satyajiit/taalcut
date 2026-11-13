// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: AI disclosure reminders · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one line led by the AI mark ("Parts of this video were made with AI…"), then one
 *   hairline row per app that asks for a label (render's DISCLOSURE_V1 under render.disclosure.<platform>.*): the
 *   app's name as a row button, its steps under it when open. The app this export is for opens first.
 * states: default (the chosen app open, the others closed) · hover (the hover surface) · focus-visible (the base
 *   ring) · active (pressed) · open/closed (aria-expanded, the chevron turns on a transform) · disabled/loading/
 *   error/success: none (reading only)
 * motion: the chevron rotates over --dur-micro; the steps appear at once (reduced motion: the same)
 * pre-emit critique: P5 H4 E5 S5 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { Platform } from '@taalcut/core';
import { AiMark, cn } from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { disclosureSteps, disclosureTitle } from './export-words';

function Row({ platform, initiallyOpen }: { platform: Platform; initiallyOpen: boolean }) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(initiallyOpen);
  const stepsId = useId();
  return (
    <li data-platform={platform} className="border-b border-rule-subtle last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={stepsId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-8 w-full items-center justify-between gap-2 rounded-sm px-1 py-1.5 text-start type-label text-ink hover:bg-hover active:bg-pressed"
      >
        {disclosureTitle(i18n, platform)}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out)',
            open && 'rotate-180',
          )}
        />
      </button>
      <p id={stepsId} hidden={!open} className="m-0 px-1 pb-2.5 type-meta text-ink-2">
        {disclosureSteps(i18n, platform)}
      </p>
    </li>
  );
}

export function Disclosures({ platforms, open }: { platforms: readonly Platform[]; open: Platform | null }) {
  const { t } = useLingui();
  return (
    <div data-slot="disclosures" className="flex flex-col gap-1.5 pt-1">
      <p className="m-0 flex items-start gap-2 type-body text-ink">
        <AiMark className="mt-0.5 size-4" />
        {t`Parts of this video were made with AI. Each app asks you to say so when you post:`}
      </p>
      <ul className="m-0 flex list-none flex-col p-0">
        {platforms.map((platform, index) => (
          <Row
            key={platform}
            platform={platform}
            initiallyOpen={open === null ? index === 0 : platform === open}
          />
        ))}
      </ul>
    </div>
  );
}

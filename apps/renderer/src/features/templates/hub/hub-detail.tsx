// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a community template (/templates/start/community/$hubId; P3-B12, UX4 tpl) ·
 *   system: DESIGN.md v0.6 + UX4 (design-tpl.md)
 * the StructurePreview playing on its beats on the viewer grey, beside what it is: its format as a kind chip,
 *   "@handle" and the rating (the name is the bar's title, never repeated here), the description and tags (the
 *   author's words, never translated), then the page's two verbs, as on its card: Use for a video (the one marigold)
 *   and Copy to my templates, with Report… as a quiet person-only action; the facts and licence; Rate it last, for
 *   after you've used it. The slots in words and the text pattern under it, unboxed
 * states: playing · paused (Pause/Play: default · hover · focus-visible · active) · copied (Open my copy) · rated ·
 *   reduced motion (a still of slot 1 and the strip, no Play) · the actions carry their own eight states
 * motion: the preview's one clock (the compositor's); nothing else moves
 */
import { useLingui } from '@lingui/react/macro';
import type { HubTemplateDetail } from '@taalcut/core';
import {
  Button,
  Chip,
  FormatChip,
  HubRatingText,
  StructurePreview,
  UserContent,
  useReducedMotion,
  VERB_ICONS,
} from '@taalcut/ui';
import { useState } from 'react';
import { ForkControl } from './fork-control';
import { HubFacts } from './hub-facts';
import { HubSlots, HubTextPattern } from './hub-structure';
import { RateControl } from './rate-control';
import { ReportDialog } from './report-dialog';

export function HubDetail({ detail, onChanged }: { readonly detail: HubTemplateDetail; onChanged(): void }) {
  const { t } = useLingui();
  const reduced = useReducedMotion() ?? false;
  const [playing, setPlaying] = useState(true);
  const { item, document } = detail;
  return (
    <div data-slot="hub-detail" className="flex flex-col gap-10">
      <div className="grid gap-8 md:grid-cols-[13rem_1fr]">
        <div className="flex w-52 max-w-full flex-col gap-2">
          <StructurePreview
            mode="frame"
            describe={false}
            structure={document.structure}
            playing={playing}
            label={t`Preview of the template’s structure`}
          />
          {reduced ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              icon={playing ? VERB_ICONS.pause : VERB_ICONS.play}
              onClick={() => setPlaying((on) => !on)}
            >
              {playing ? t`Pause` : t`Play`}
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 type-body text-ink-2">
              {item.formatId ? <FormatChip formatId={item.formatId} /> : null}
              <UserContent translate="no">@{item.handle}</UserContent>
              <HubRatingText rating={item.rating} />
            </div>
            {item.description ? (
              <UserContent translate="no" className="max-w-prose type-prose text-ink">
                {item.description}
              </UserContent>
            ) : null}
            {item.tags.length > 0 ? (
              <ul aria-label={t`Tags`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {item.tags.map((tag) => (
                  <li key={tag}>
                    <Chip translate="no">#{tag}</Chip>
                  </li>
                ))}
              </ul>
            ) : null}
          </header>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <ForkControl item={item} />
            <ReportDialog hubId={item.id} />
          </div>
          <HubFacts item={item} document={document} />
          <RateControl hubId={item.id} mine={detail.myRating} onRated={onChanged} />
        </div>
      </div>
      <HubSlots structure={document.structure} />
      <HubTextPattern structure={document.structure} />
    </div>
  );
}

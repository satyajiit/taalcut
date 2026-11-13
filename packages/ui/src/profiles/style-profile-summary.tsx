// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: style profile summary, "What your saved reels have in common" (LRN1-STY)
 * genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 · a section on the page's raised
 *   surface with a rule edge and the xs lift so it reads in dark (UX3; not a decision card: nothing to decide): the
 *   title (section heading, 600, led by the two-circles "in common" icon),
 *   how many templates it's measured from, the eight measured numbers (StyleProfileFacts: Taalcut's measurements,
 *   no accent), the most typical templates (StyleProfileExemplars), then the model's paragraph led by the AI mark
 *   (StyleProfileParagraph). Two accents at most: violet on the AI mark, marigold only on focus
 * states: loading (the host's Skeleton over StyleProfileBones) · empty (nothing broken down yet: one line saying what
 *   fills it) · one template (its own numbers, said so with what makes it a set; no "most like the rest") · default
 *   (numbers, exemplars, paragraph) · summary writing / written here / written in the cloud / no
 *   model / not yet / failed · busy (refreshing: the last answer stays, aria-busy) · the controls inside carry
 *   Button's eight states
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { StyleProfileView, TaalcutError, TemplateId, TemplateSummarySheet } from '@taalcut/core';
import { useId } from 'react';
import { CONCEPT_ICONS } from '../icons/concepts';
import { cn } from '../lib/cn';
import { StyleProfileExemplars } from './style-profile-exemplars';
import { StyleProfileFacts } from './style-profile-facts';
import { StyleProfileParagraph } from './style-profile-paragraph';
import {
  EMPTY_WORDS,
  HEADING_WORDS,
  ONE_TEMPLATE_WORDS,
  STYLE_PROFILE_COMPARE_MIN,
} from './style-profile-words';

export interface StyleProfileSummaryProps {
  readonly view: StyleProfileView;
  /** The title's level in the page (a page section: 2; inside a card: 3). */
  readonly level?: 2 | 3;
  readonly sheetUrl: (sheet: TemplateSummarySheet) => string | null;
  readonly onOpenTemplate?: (templateId: TemplateId) => void;
  /** templates.writeStyleSummary for this set; without it the paragraph offers nothing. */
  readonly onWriteAgain?: () => void;
  readonly asking?: boolean;
  readonly askFailure?: TaalcutError | null;
  /** The same set is being read again: the answer stays, marked busy. */
  readonly refreshing?: boolean;
  readonly className?: string;
}

export type StyleProfileBodyProps = Omit<StyleProfileSummaryProps, 'level' | 'refreshing' | 'className'> & {
  /** The exemplars' title: one under the host's heading. */
  readonly level: 3 | 4;
};

/** The section's content under any heading: the numbers, the most typical templates and the paragraph, or what fills
 * an empty set; a set of one says its numbers are that template's own. Every page's section and the chat card show
 * it. */
export function StyleProfileBody({
  view,
  level,
  sheetUrl,
  onOpenTemplate,
  onWriteAgain,
  asking,
  askFailure,
}: StyleProfileBodyProps) {
  const { i18n } = useLingui();
  if (!view.profile)
    return (
      <p data-slot="style-profile-empty" className="m-0 max-w-[65ch] type-body text-ink-2">
        {i18n._(EMPTY_WORDS[view.source.kind])}
      </p>
    );
  const one = view.profile.members < STYLE_PROFILE_COMPARE_MIN;
  return (
    <>
      {one ? (
        <p data-slot="style-profile-one" className="m-0 max-w-[65ch] type-body text-ink-2">
          {i18n._(ONE_TEMPLATE_WORDS[view.source.kind])}
        </p>
      ) : null}
      <StyleProfileFacts profile={view.profile} />
      {one ? null : (
        <StyleProfileExemplars
          exemplars={view.exemplars}
          sheetUrl={sheetUrl}
          level={level}
          {...(onOpenTemplate ? { onOpen: onOpenTemplate } : {})}
        />
      )}
      <StyleProfileParagraph
        summary={view.summary}
        {...(onWriteAgain ? { onWriteAgain } : {})}
        {...(asking !== undefined ? { asking } : {})}
        {...(askFailure !== undefined ? { askFailure } : {})}
      />
    </>
  );
}

/** "Measured from 3 templates": how many members the numbers come from. */
export function MeasuredFrom({ members }: { members: number }) {
  const { t } = useLingui();
  return (
    <>{t`${plural(members, { one: 'Measured from # template', other: 'Measured from # templates' })}`}</>
  );
}

/** What a set of the person's references has in common: measured numbers first, a model's words last. */
export function StyleProfileSummary({
  view,
  level = 2,
  refreshing,
  className,
  ...body
}: StyleProfileSummaryProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      data-slot="style-profile"
      data-source={view.source.kind}
      aria-labelledby={titleId}
      aria-busy={refreshing === true || undefined}
      className={cn('flex flex-col gap-4 rounded-lg border border-rule bg-raised p-4 shadow-xs', className)}
    >
      <header className="flex flex-col gap-0.5">
        <Heading id={titleId} className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
          <CONCEPT_ICONS.styleProfile aria-hidden className="size-5 shrink-0 text-ink-3" />
          {i18n._(HEADING_WORDS[view.source.kind])}
        </Heading>
        {view.profile ? (
          <p className="m-0 type-meta text-ink-2">
            <MeasuredFrom members={view.profile.members} />
          </p>
        ) : null}
      </header>
      <StyleProfileBody view={view} level={level === 2 ? 3 : 4} {...body} />
    </section>
  );
}

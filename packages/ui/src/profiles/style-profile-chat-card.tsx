// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: style profile card (LRN1-STY) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 (A3) · templates.styleProfile's result card: an information card (hairline frame, no
 *   icon, no edge, nothing to decide), titled by what the set is; under it the set's own name (user or Instagram
 *   text, never translated) and how many templates the numbers come from; then StyleProfileBody as the Saved page
 *   shows it. A snapshot of what the agent read: the paragraph's Try again lives on the set's page, not here
 * states: default (numbers, exemplars, paragraph) · empty set (what fills it) · each summary state
 *   (StyleProfileParagraph) · an exemplar row opens its template when the host can navigate
 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { useCardActions } from '../cards/card-actions';
import { useCardData } from '../cards/card-data';
import { CardFrame, UserContent } from '../cards/card-frame';
import { MeasuredFrom, StyleProfileBody } from './style-profile-summary';
import { HEADING_WORDS } from './style-profile-words';

export function StyleProfileChatCard({ card }: { card: CardOf<'styleProfile'> }) {
  const { i18n } = useLingui();
  const { navigate } = useCardActions();
  const data = useCardData();
  const { view } = card;
  return (
    <CardFrame
      cardType="styleProfile"
      data-source={view.source.kind}
      title={i18n._(HEADING_WORDS[view.source.kind])}
    >
      {view.name !== null || view.profile ? (
        <p className="m-0 -mt-2 flex flex-wrap gap-x-2 text-xs text-ink-2">
          {view.name !== null ? (
            <UserContent translate="no" dir="auto" className="font-medium text-ink">
              {view.name}
            </UserContent>
          ) : null}
          {view.profile ? (
            <span>
              <MeasuredFrom members={view.profile.members} />
            </span>
          ) : null}
        </p>
      ) : null}
      <StyleProfileBody
        view={view}
        level={4}
        sheetUrl={(sheet) => data.templateAssetUrl?.(sheet) ?? null}
        {...(navigate ? { onOpenTemplate: (templateId) => navigate({ to: 'template', templateId }) } : {})}
      />
    </CardFrame>
  );
}

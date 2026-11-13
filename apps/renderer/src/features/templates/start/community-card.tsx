// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a community template as a Start from… card (/templates/start/community; UX4
 *   tpl) · system: DESIGN.md v0.6 + UX4 (design-tpl.md, "The Start from… card")
 * the shared template's slots as a storyboard on the viewer grey (the roles' marks and the beats; hover or focus
 *   plays the first 3 s), its kind mark, its name (the author's words, never translated; a link to its page), the
 *   author's description in two lines at most, then "@handle · language · length · slots · rating", Use for a video
 *   and Copy to my templates. A copy this Mac already has is used as it is and shows Open my copy
 * states: the card's (start-card.tsx); the name link: default · hover (underline) · focus-visible (base ring) ·
 *   active (ink-2)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { HubBrowseItem } from '@taalcut/core';
import {
  HubRatingText,
  languageName,
  StructurePreview,
  toSeconds,
  useFormatters,
  UserContent,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { CAPTURE_HUB_ITEMS } from '../capture/hub-fixtures';
import { KindMark } from '../kind-tile';
import { CARD_GRID, StartCard } from './start-card';

function Facts({ item }: { item: HubBrowseItem }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const parts = [
    item.language ? languageName(i18n, item.language) : null,
    format.duration(toSeconds(item.duration) * 1000),
    t`${plural(item.slotCount, { one: '# slot', other: '# slots' })}`,
  ].filter((part): part is string => part !== null);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <UserContent translate="no">@{item.handle}</UserContent>
      {parts.map((part) => (
        <span key={part} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="text-ink-3">
            ·
          </span>
          {part}
        </span>
      ))}
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      <HubRatingText rating={item.rating} />
    </span>
  );
}

export function CommunityCard({ item }: { item: HubBrowseItem }) {
  const { t } = useLingui();
  return (
    <StartCard
      data-hub-id={item.id}
      title={
        <Link
          to="/templates/start/community/$hubId"
          params={{ hubId: item.id }}
          data-slot="hub-card-open"
          className="rounded-sm underline-offset-4 hover:underline active:text-ink-2"
        >
          <UserContent translate="no">{item.name}</UserContent>
        </Link>
      }
      name={item.name}
      {...(item.formatId ? { mark: <KindMark formatId={item.formatId} /> } : {})}
      preview={(playing) => (
        <StructurePreview
          mode="strip"
          look="viewer"
          strip={item}
          playing={playing}
          describe={false}
          label={t`Structure`}
          className="w-full"
        />
      )}
      clampLine
      line={
        item.description ? (
          <UserContent translate="no">{item.description}</UserContent>
        ) : (
          t`Shared without a description.`
        )
      }
      facts={<Facts item={item} />}
      source={{
        kind: 'community',
        hubId: item.id,
        version: item.version,
        sha256: item.sha256,
        forkedAs: item.forkedAs,
      }}
    />
  );
}

/**
 * What the capture browser draws for Start from…'s cards ("start-cards", and the community's "hub-list"): five
 * community cards, the anatomy every Start from… card shares.
 */
export function CardsFixture() {
  return (
    <ul className={CARD_GRID}>
      {CAPTURE_HUB_ITEMS.map((item) => (
        <CommunityCard key={item.id} item={item} />
      ))}
    </ul>
  );
}

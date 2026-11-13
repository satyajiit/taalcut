// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: a brand kit's views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks through SettingsViews)
 * Colours, Type, Captions, Logo (with the watermark) and Intro and outro, each its own page of the editor, with the
 *   live preview kept beside every one. Each is led by its glyph.
 * states: the kit's ViewLink: default · hover · focus-visible · active · current */
import { useLingui } from '@lingui/react/macro';
import type { StyleId } from '@taalcut/core';
import { Link } from '@tanstack/react-router';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { SettingsViews } from '../settings/settings-page';

export const BRAND_VIEWS = ['colours', 'type', 'captions', 'logo', 'intro-outro'] as const;
export type BrandViewId = (typeof BRAND_VIEWS)[number];

/** The view a kit's URL is on ('/settings/brand/<id>/logo' → 'logo'); Colours otherwise. */
export function brandViewOf(pathname: string): BrandViewId {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1);
  return BRAND_VIEWS.find((view) => view === last) ?? 'colours';
}

export function BrandKitViews({ styleId, current }: { styleId: StyleId; current: BrandViewId }) {
  const { t } = useLingui();
  const params = { styleId };
  return (
    <SettingsViews
      label={t`Brand kit`}
      current={current}
      views={[
        {
          id: 'colours',
          label: t`Colours`,
          icon: SETTINGS_ICONS.colours,
          link: <Link to="/settings/brand/$styleId/colours" params={params}>{t`Colours`}</Link>,
        },
        {
          id: 'type',
          label: t`Type`,
          icon: SETTINGS_ICONS.type,
          link: <Link to="/settings/brand/$styleId/type" params={params}>{t`Type`}</Link>,
        },
        {
          id: 'captions',
          label: t`Captions`,
          icon: SETTINGS_ICONS.captions,
          link: <Link to="/settings/brand/$styleId/captions" params={params}>{t`Captions`}</Link>,
        },
        {
          id: 'logo',
          label: t`Logo`,
          icon: SETTINGS_ICONS.logo,
          link: <Link to="/settings/brand/$styleId/logo" params={params}>{t`Logo`}</Link>,
        },
        {
          id: 'intro-outro',
          label: t`Intro and outro`,
          icon: SETTINGS_ICONS.bumpers,
          link: <Link to="/settings/brand/$styleId/intro-outro" params={params}>{t`Intro and outro`}</Link>,
        },
      ]}
    />
  );
}

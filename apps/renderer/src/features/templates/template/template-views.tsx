// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's views (UX4 tpl) · system: DESIGN.md v0.6 + UX4 (ViewLinks;
 *   design-tpl.md)
 * a template's four pages as the kit's ViewLinks in Page's views slot: Overview (decide and make a video), Slots
 *   (check and approve), Pacing (how often the cuts come) and Details (facts, versions, sharing). Each is its own
 *   URL under the template, and the version being read (`?version=`) goes with you
 * states: the kit's ViewLink: default · hover · focus-visible · active · current
 */
import { useLingui } from '@lingui/react/macro';
import type { TemplateId } from '@taalcut/core';
import { ViewLink, ViewLinks } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { TEMPLATE_ICONS } from '../template-icons';

export type TemplatePageView = 'overview' | 'slots' | 'pacing' | 'details';

export function TemplateViews({
  templateId,
  current,
  version,
}: {
  templateId: TemplateId;
  current: TemplatePageView;
  version: number | undefined;
}) {
  const { t } = useLingui();
  const params = { templateId };
  const search = { version };
  return (
    <ViewLinks label={t`Template`} data-slot="template-views">
      <ViewLink asChild current={current === 'overview'} icon={TEMPLATE_ICONS.overview}>
        <Link activeOptions={{ exact: true }} to="/templates/$templateId" params={params} search={search}>
          {t`Overview`}
        </Link>
      </ViewLink>
      <ViewLink asChild current={current === 'slots'} icon={TEMPLATE_ICONS.slots}>
        <Link
          activeOptions={{ exact: true }}
          to="/templates/$templateId/slots"
          params={params}
          search={search}
        >
          {t`Slots`}
        </Link>
      </ViewLink>
      <ViewLink asChild current={current === 'pacing'} icon={TEMPLATE_ICONS.pacing}>
        <Link
          activeOptions={{ exact: true }}
          to="/templates/$templateId/pacing"
          params={params}
          search={search}
        >
          {t`Pacing`}
        </Link>
      </ViewLink>
      <ViewLink asChild current={current === 'details'} icon={TEMPLATE_ICONS.details}>
        <Link
          activeOptions={{ exact: true }}
          to="/templates/$templateId/details"
          params={params}
          search={search}
        >
          {t`Details`}
        </Link>
      </ViewLink>
    </ViewLinks>
  );
}

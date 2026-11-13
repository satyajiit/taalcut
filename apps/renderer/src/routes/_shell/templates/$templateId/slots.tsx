// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TemplatePart } from '../../../../features/templates/template/template-context';
import { TemplateSlots } from '../../../../features/templates/template/template-slots';

/** `?slot=3` opens on the third slot (the overview's Open in Slots). */
interface SlotsSearch {
  slot?: number | undefined;
}

/** A template's slots (UX4 tpl): check and approve them. */
export const Route = createFileRoute('/_shell/templates/$templateId/slots')({
  validateSearch: (search: Record<string, unknown>): SlotsSearch => {
    const slot = Number(search.slot);
    return { slot: Number.isInteger(slot) && slot >= 1 && slot <= 200 ? slot : undefined };
  },
  component: Slots,
});

function Slots() {
  const { slot } = Route.useSearch();
  return <TemplatePart name="template-slots" render={(view) => <TemplateSlots view={view} slot={slot} />} />;
}

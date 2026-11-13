// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TemplatePart } from '../../../../features/templates/template/template-context';
import { TemplateDetails } from '../../../../features/templates/template/template-details';

/** A template's details (UX4 tpl): its facts, look, versions and sharing. */
export const Route = createFileRoute('/_shell/templates/$templateId/details')({
  component: () => (
    <TemplatePart name="template-details" render={(view) => <TemplateDetails view={view} />} />
  ),
});

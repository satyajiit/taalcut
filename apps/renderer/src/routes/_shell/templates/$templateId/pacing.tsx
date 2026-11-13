// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TemplatePacing } from '../../../../features/templates/pacing/template-pacing';
import { TemplatePart } from '../../../../features/templates/template/template-context';

/** A template's pacing (UX4 tpl): how often the cuts come. */
export const Route = createFileRoute('/_shell/templates/$templateId/pacing')({
  component: () => (
    <TemplatePart
      name="template-pacing"
      render={(view) => <TemplatePacing template={view.template} readOnly={!view.latest} />}
    />
  ),
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TemplatePart } from '../../../../features/templates/template/template-context';
import { TemplateOverview } from '../../../../features/templates/template/template-overview';

/** A template's overview (UX4 tpl): Make a video with this, how ready it is, and its slots on the reel's sound. */
export const Route = createFileRoute('/_shell/templates/$templateId/')({
  component: () => (
    <TemplatePart name="template-detail" render={(view) => <TemplateOverview view={view} />} />
  ),
});

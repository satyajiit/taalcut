// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `template.setStyle` (P3-V10): one new template version, undone by `template.setHead`. */
import {
  defineCommand,
  err,
  NotFoundError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type ProjectId,
  type StyleStore,
  type TemplateEditResult,
  type TemplateId,
} from '@taalcut/core';
import { StyleNotFound } from '../errors';
import type { TemplateService } from '../store/template-service';

const N = TEMPLATE_COMMANDS;

export function createSetStyleCommand(deps: {
  readonly service: TemplateService;
  readonly styles: StyleStore;
}) {
  return defineCommand({
    name: N.setStyle,
    payload: templateCommandPayloads[N.setStyle],
    sideEffect: 'write',
    handle: async ({ projectId, templateId, baseVersion, styleId }, context) => {
      if (styleId !== null) {
        const found = await deps.styles.get(styleId);
        if (!found.ok) return NotFoundError.is(found.error) ? err(StyleNotFound()) : found;
      }
      const outcome = await deps.service.edit(
        {
          templateId,
          baseVersion,
          command: N.setStyle,
          payload: { projectId, templateId, baseVersion, styleId },
          change: (template) => ok({ ...template, styleId }),
        },
        context,
      );
      if (!outcome.ok) return outcome;
      const result: TemplateEditResult = { templateId, version: outcome.value.version };
      return ok({ result, inverse: setHeadInverse(projectId, templateId, baseVersion, result.version) });
    },
  });
}

function setHeadInverse(
  projectId: ProjectId | null,
  templateId: TemplateId,
  version: number,
  expectedHead: number,
) {
  return { name: N.setHead, payload: { projectId, templateId, version, expectedHead } };
}

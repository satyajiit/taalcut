// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * hub.fork from the app (P3-B12): the renderer makes the new template's id, the bus runs the fork (undo removes
 * it), and the result is the copy's id. The card and the detail page fork the same way.
 */
import {
  callRpc,
  HUB_COMMANDS,
  newId,
  ok,
  type HubTemplateId,
  type Result,
  type TemplateId,
} from '@taalcut/core';
import type { Backend } from '../../../backend/backend';

export interface ForkRequest {
  readonly hubId: HubTemplateId;
  readonly version: number;
  readonly sha256: string;
}

export async function forkFromHub(
  backend: Backend,
  request: ForkRequest,
): Promise<Result<{ templateId: TemplateId }>> {
  const templateId = newId<'Template'>();
  const done = await callRpc(
    backend.commands.dispatch({
      name: HUB_COMMANDS.fork,
      payload: { projectId: null, ...request, templateId },
      source: 'ui',
    }),
  );
  return done.ok ? ok({ templateId }) : done;
}

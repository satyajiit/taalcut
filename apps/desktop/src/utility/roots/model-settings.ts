// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Models in the agent process: appContract.models over models'
 * ModelSettingsService, which reads the live profiles (the ModelClient's
 * selector, so a change applies to the very next call). Its commands
 * (models.setProfile and the rest) are registered on the bus by the root.
 */
import { implementContract, modelsContract } from '@taalcut/core';
import type { ModelSettingsService } from '@taalcut/models';
import { toWire, wireStream } from '../../shared/wire';

export function modelsRouter(service: ModelSettingsService) {
  const os = implementContract(modelsContract);
  return os.router({
    settings: os.settings.handler(() => toWire(service.settings())),
    changed: os.changed.handler(({ signal }) => wireStream(service.changed(signal))),
    options: os.options.handler(async ({ input }) => toWire(await service.options(input))),
  });
}

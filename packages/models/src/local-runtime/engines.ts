// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One driver over each engine's (MLX1): a launch goes to the driver of the engine its first model names
 * (`LocalRuntimeModel.engine`; the supervisor puts the model it serves first, with the others that engine serves).
 */
import { engineOf, type LocalEngine, type LocalRuntimeDriver } from './types';

export type { LocalEngine } from './types';

export function createEngineDriver(
  drivers: Readonly<Partial<Record<LocalEngine, LocalRuntimeDriver>>>,
): LocalRuntimeDriver {
  return {
    launch(input) {
      const first = input.models[0];
      if (!first) return Promise.reject(new Error('No model to load.'));
      const engine = engineOf(first.model);
      const driver = drivers[engine];
      if (!driver) return Promise.reject(new Error(`No driver for the ${engine} engine.`));
      return driver.launch(input);
    },
  };
}

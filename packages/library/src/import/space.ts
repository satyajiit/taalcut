// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult, ImportSpacePort } from '@taalcut/core';

/** Structural port keeps the durable sink usable with either the shared budget or a test budget. */
export interface ImportSinkSpaceCoordinator {
  reserve(owner: string, volume: string, destination: string, bytes: number): AsyncResult<void>;
  consume(owner: string, bytes: number): void;
  release(owner: string): void;
  reserved(volume: string): number;
}
export function bindImportSpace(
  space: ImportSinkSpaceCoordinator,
  place: () => AsyncResult<{ volume: string; dir: string }>,
): ImportSpacePort {
  return {
    async reserve(owner, bytes) {
      const current = await place();
      return current.ok ? space.reserve(owner, current.value.volume, current.value.dir, bytes) : current;
    },
    consume: (owner, bytes) => space.consume(owner, bytes),
    release: (owner) => space.release(owner),
  };
}

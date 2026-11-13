// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type BreakdownInput, type BreakdownSystem } from './types';

export function syntheticBreakdownSystem(cutsByReelId: Record<string, number[]>): BreakdownSystem {
  return {
    predictCuts(input: BreakdownInput): Promise<number[]> {
      const cuts = cutsByReelId[input.reelId];
      if (cuts === undefined) return Promise.reject(new Error(`No synthetic cuts for reel ${input.reelId}`));
      return Promise.resolve([...cuts]);
    },
  };
}

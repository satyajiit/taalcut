// Copied to packages/tools/src/__lint_fixture_cycle_b.ts (imports the paired copy).
import { markerA } from './__lint_fixture_cycle_a';

export const markerB = 2;
export const cycleB = markerA;

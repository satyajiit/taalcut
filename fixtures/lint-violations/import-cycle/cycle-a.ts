// Copied to packages/tools/src/__lint_fixture_cycle_a.ts (imports the paired copy).
import { markerB } from './__lint_fixture_cycle_b';

export const markerA = 1;
export const cycleA = markerB;

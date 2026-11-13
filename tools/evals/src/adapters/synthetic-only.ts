// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Some adapters build the system's input from the labels themselves (the labelled boxes as the subject track, the
 * labelled fillers as the speech analysis), or ignore the labels. On generated fixtures that tests the planner; on real
 * labels it would score the labels against themselves and claim a gate. Those adapters refuse real labels until the
 * real input path (named in `needs`) is wired.
 */
export function requireSyntheticLabels(
  suite: string,
  labels: readonly { synthetic: boolean }[],
  needs: string,
): void {
  if (labels.some((label) => !label.synthetic)) {
    throw new Error(`${suite}: real labels need ${needs}. This adapter only scores generated fixtures.`);
  }
}

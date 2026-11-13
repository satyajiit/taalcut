// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local only (P3-B10, G27; packages/models SPEC P3.6): what a run may still do with Settings → Privacy → Local
 * only on. The model client refuses every cloud model while it is on, so a tool whose internet use is its cloud
 * modules (core requires `network: 'internet'` with `cloudModules`) still runs when each of those modules has a
 * model on this Mac, and nothing it does leaves the device: it needs no upload consent. A tool that reaches the
 * internet any other way (a link fetch, stock search, the hub) is refused.
 */
import type { ToolPermission } from '@taalcut/core';

export interface LocalOnlyDeps {
  /** Settings → Privacy → Local only as it is now. A run logs it when it starts (`run.started.localOnly`). */
  readonly now: () => boolean;
  /**
   * The module has a model on this Mac to run on under the active profile (models' `moduleQuality` with Local
   * only applied isn't `unavailable`), so the labels and what a run may do agree.
   */
  readonly onDevice: (module: string) => boolean;
}

export const LOCAL_ONLY_REFUSAL = 'Local-only mode is on, and this tool uses the internet.';

/** Why Local only refuses this tool, or undefined when it may run on this Mac. */
export function localOnlyRefusal(
  permission: ToolPermission,
  onDevice: ((module: string) => boolean) | undefined,
): string | undefined {
  const modules = permission.cloudModules ?? [];
  if (modules.length > 0) return onDevice && modules.every(onDevice) ? undefined : LOCAL_ONLY_REFUSAL;
  return permission.network === 'internet' ? LOCAL_ONLY_REFUSAL : undefined;
}

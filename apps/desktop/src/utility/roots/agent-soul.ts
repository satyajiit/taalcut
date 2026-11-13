// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Soul v1 in the agent process (packages/agent SPEC section 22): the bundled SOUL.md, read strictly (a file
 * without a version or with a broken dial table stops the agent from starting rather than running without
 * its persona), the `agent.setSoulDials` command and the `soul.setDials` tool. The dials themselves reach
 * each run through agent-launch.ts.
 */
import {
  createToken,
  SettingsStoreToken,
  type AnyCommand,
  type Container,
  type ToolModule,
} from '@taalcut/core';
import { createSoulCommands, readSoul, soulToolModule, type Soul } from '@taalcut/agent';

/** SOUL.md as this build bundles it. */
export const SoulToken = createToken<Soul>('agent.soul');

/** Registers the bundled SOUL.md; throws (a build error, caught at composition) when it doesn't parse. */
export function registerSoul(container: Container, text: string): void {
  const soul = readSoul(text);
  if (!soul.ok)
    throw new Error(`SOUL.md is invalid (${soul.error.code}): ${soul.error.detail ?? 'no detail'}`);
  container.value(SoulToken, soul.value);
}

export function soulToolModules(container: Container): ToolModule[] {
  const { stops } = container.resolve(SoulToken);
  return stops ? [soulToolModule({ stops })] : [];
}

export function soulCommands(container: Container): AnyCommand[] {
  return createSoulCommands({ settings: container.resolve(SettingsStoreToken) }).all;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The update channel commands on the agent's bus (P3-B9, P3-B14). `updates.setChannel` stores the person's
 * public channel (core UPDATE_CHANNEL_SETTING); only a person at this Mac may change it (PERSON_SOURCES: never
 * the agent or an MCP client), and Beta needs the beta terms (core BETA_TERMS) agreed first, else
 * desktop.beta_terms_required, whose fix opens them. `null` is the build's own channel. Undo puts the previous
 * choice back through `updates.setChannel` too, null included (contract round P3-3). Main re-reads the setting
 * on command.changed and re-points the updater (main/update/channel-setting.ts). An unchanged choice writes
 * nothing.
 */
import {
  AcknowledgementStoreToken,
  BETA_TERMS,
  defineCommand,
  defineError,
  err,
  ok,
  PERSON_SOURCES,
  SettingsStoreToken,
  UPDATE_CHANNEL_SETTING,
  UPDATE_COMMANDS,
  updateCommandPayloads,
  type AcknowledgementStore,
  type AnyCommand,
  type AsyncResult,
  type CommandContext,
  type CommandOutcome,
  type Container,
  type PublicUpdateChannel,
  type SettingsStore,
} from '@taalcut/core';

/** Beta was chosen before the beta terms were agreed; the fix opens them. */
export const BetaTermsRequired = defineError<{ featureId: string; termsVersion: string }>(
  'desktop.beta_terms_required',
);

export interface UpdateCommandDeps {
  readonly settings: SettingsStore;
  readonly acknowledgements: Pick<AcknowledgementStore, 'has'>;
}

export function createUpdateCommands(deps: UpdateCommandDeps): AnyCommand[] {
  async function change(
    channel: PublicUpdateChannel | null,
    context: CommandContext,
  ): AsyncResult<CommandOutcome<{ channel: PublicUpdateChannel | null }>> {
    if (channel === 'beta') {
      const agreed = await deps.acknowledgements.has(BETA_TERMS.featureId, BETA_TERMS.termsVersion);
      if (!agreed.ok) return agreed;
      if (!agreed.value) return err(BetaTermsRequired({ ...BETA_TERMS }));
    }
    const before = await deps.settings.get(UPDATE_CHANNEL_SETTING);
    if (!before.ok) return before;
    if (before.value === channel) return ok({ result: { channel } });
    // Commits with this command's audit row (undo and redo too), not before it.
    const saved = await deps.settings.set(UPDATE_CHANNEL_SETTING, channel, context);
    if (!saved.ok) return saved;
    return ok({
      result: { channel },
      inverse: { name: UPDATE_COMMANDS.setChannel, payload: { projectId: null, channel: before.value } },
    });
  }

  const setChannel = defineCommand({
    name: UPDATE_COMMANDS.setChannel,
    payload: updateCommandPayloads[UPDATE_COMMANDS.setChannel],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    handle: ({ channel }, context) => change(channel, context),
  });

  return [setChannel];
}

/** For agent-root.ts's bus. */
export function agentUpdateCommands(container: Container): AnyCommand[] {
  return createUpdateCommands({
    settings: container.resolve(SettingsStoreToken),
    acknowledgements: container.resolve(AcknowledgementStoreToken),
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { MODEL_COMMANDS, type ModelOption, type ReasoningLevel } from '@taalcut/core';
import {
  nearestThinkingLevel,
  toast,
  type ComposerModelOption,
  type ComposerModels,
  type ComposerThinkingReason,
  type ThinkingModel,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useBackend, type Backend } from '../backend/backend';
import { useCommand } from '../backend/use-command';
import { useRpcQuery, useRpcStream } from '../backend/use-rpc';
import { describeError } from '../features/settings/model-messages';
import { providerName } from '../features/settings/providers';

const keyOf = (choice: { provider: string; model: string }) => `${choice.provider}/${choice.model}`;
/** A model whose levels aren't known yet (the list is loading) thinks the usual way, without Max. */
const USUAL_THINKING: readonly ReasoningLevel[] = ['off', 'low', 'medium', 'high'];

interface PickedReasoningEntry {
  picked?: ReasoningLevel | undefined;
  readonly listeners: Set<() => void>;
}

const pickedReasoningByBackend = new WeakMap<object, PickedReasoningEntry>();

function entryFor(backend: object): PickedReasoningEntry {
  let entry = pickedReasoningByBackend.get(backend);
  if (!entry) {
    entry = { listeners: new Set() };
    pickedReasoningByBackend.set(backend, entry);
  }
  return entry;
}

/** The thinking level picked in this session on `backend`, if any. */
export function getPickedReasoning(backend: Backend): ReasoningLevel | undefined {
  return pickedReasoningByBackend.get(backend)?.picked;
}

export interface AgentModel {
  /** The composer's model button and menu. Undefined until the settings have loaded. */
  models: ComposerModels | undefined;
  /** The agent model's reasoning levels, exactly its provider's: what the thinking button offers. */
  thinking: readonly ReasoningLevel[];
  /** Whose levels they are, for their names (OpenAI's off is None). */
  model: ThinkingModel | undefined;
  /** What a chat that hasn't picked a level thinks at: the job's level (its profile's), as this model has it. */
  defaultReasoning: ReasoningLevel;
  /** The thinking level picked in this session, if any: shared across Chat and the docked editor chat. */
  pickedReasoning: ReasoningLevel | undefined;
  /** Saves the thinking level picked in the composer so switching pages or conversations keeps it. */
  setReasoning: (level: ReasoningLevel) => Promise<void>;
  /** Why the model answers without thinking, if it does. */
  reason: ComposerThinkingReason | undefined;
}

/**
 * The agent's model for the composer: the model in use (Settings → Models'
 * agent job, as the next call resolves it), the models of connected accounts
 * and keys plus the on-device model once downloaded, by provider, and a
 * switch that is the same live, undoable command Settings runs
 * (models.setModuleOverride for the agent). It is one setting for every chat,
 * as in Settings: the model decides where your words go, so it must not
 * change behind your back from one chat to the next.
 */
export function useAgentModel(): AgentModel {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const command = useCommand({ toast: false });
  const settings = useRpcStream((signal) => backend.models.changed(undefined, { signal }), [backend]);
  const accounts = useRpcStream((signal) => backend.accounts.changed(undefined, { signal }), [backend]);
  // A switch, a new tier or a key added changes the list: fetched again after either stream moves.
  const options = useRpcQuery(
    (signal) => backend.models.options({ module: 'agent' }, { signal }),
    [backend, settings.data, accounts.data],
  );

  const agent = settings.data?.modules.find((m) => m.module === 'agent');
  const primary = agent?.chain[0];
  const list = options.data;
  const option: ModelOption | undefined = primary
    ? list?.find((o) => keyOf(o) === keyOf(primary))
    : undefined;

  const groupOf = useCallback(
    (choice: { provider: string; local?: boolean }) =>
      choice.local ? t`On this Mac` : (providerName(i18n, choice.provider) ?? choice.provider),
    [i18n, t],
  );

  const sharedPicked = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const entry = entryFor(backend);
        entry.listeners.add(onStoreChange);
        return () => {
          entry.listeners.delete(onStoreChange);
        };
      },
      [backend],
    ),
    () => getPickedReasoning(backend),
  );
  const overrideReasoning = agent?.override?.reasoning;
  const lastOverrideRef = useRef<ReasoningLevel | undefined>(overrideReasoning);
  useEffect(() => {
    const entry = entryFor(backend);
    if (overrideReasoning !== lastOverrideRef.current) {
      lastOverrideRef.current = overrideReasoning;
      if (entry.picked !== overrideReasoning) {
        entry.picked = overrideReasoning;
        for (const listener of entry.listeners) listener();
      }
    } else if (overrideReasoning !== undefined && entry.picked === undefined) {
      entry.picked = overrideReasoning;
      for (const listener of entry.listeners) listener();
    }
  }, [backend, overrideReasoning]);
  const pickedReasoning = sharedPicked ?? overrideReasoning;

  const run = command.run;
  const setModel = useCallback(
    async (key: string) => {
      const chosen = list?.find((o) => keyOf(o) === key);
      if (!chosen || !agent || (primary && keyOf(primary) === key)) return;
      // As Settings does: the job keeps its thinking level, as the nearest the new model has (UX3-AGT).
      const kept = pickedReasoning ?? agent.override?.reasoning ?? primary?.reasoning;
      const reasoning = kept && chosen.thinking ? nearestThinkingLevel(kept, chosen.thinking) : kept;
      const result = await run({
        name: MODEL_COMMANDS.setModuleOverride,
        payload: {
          module: 'agent',
          override: {
            ...agent.override,
            primary: { provider: chosen.provider, model: chosen.model },
            ...(reasoning ? { reasoning } : {}),
          },
        },
      });
      if (!result.ok)
        toast({
          tone: 'danger',
          title: t`Couldn’t switch the model`,
          description: describeError(i18n, result.error),
        });
    },
    [list, agent, primary, pickedReasoning, run, t, i18n],
  );

  const setReasoning = useCallback(
    async (level: ReasoningLevel) => {
      lastOverrideRef.current = level;
      const entry = entryFor(backend);
      entry.picked = level;
      for (const listener of entry.listeners) listener();
      if (!agent) return;
      await run({
        name: MODEL_COMMANDS.setModuleOverride,
        payload: {
          module: 'agent',
          override: {
            ...agent.override,
            reasoning: level,
          },
        },
      });
    },
    [backend, agent, run],
  );

  const models = useMemo<ComposerModels | undefined>(() => {
    if (!primary) return undefined;
    const current: ComposerModelOption = {
      key: keyOf(primary),
      name: option?.name ?? primary.model,
      group: groupOf({ provider: primary.provider, local: option?.local ?? false }),
      provider: primary.provider,
      local: option?.local ?? false,
    };
    // Usable now (a key or sign-in, downloaded), and Taalcut's own picks: Settings has the long list.
    const offered = (list ?? [])
      .filter((o) => o.unavailable === undefined && (o.inProfile === true || keyOf(o) === current.key))
      .map((o) => ({
        key: keyOf(o),
        name: o.name,
        group: groupOf(o),
        provider: o.provider,
        local: o.local,
      }));
    // One block per provider, in the order the list first names it; this Mac's model last.
    const groups = [
      ...new Set([...offered.filter((o) => !o.local), ...offered.filter((o) => o.local)].map((o) => o.group)),
    ];
    return {
      current,
      options: groups.flatMap((group) => offered.filter((o) => o.group === group)),
      onChange: (key) => void setModel(key),
      onMore: () => void navigate({ to: '/settings/models', search: { advanced: true } }),
    };
  }, [primary, option, list, groupOf, setModel, navigate]);

  const thinking = useMemo(
    () => option?.thinking ?? (option && !option.reasoning ? ['off' as const] : USUAL_THINKING),
    [option],
  );
  const thinks = thinking.some((level) => level !== 'off');
  const reason: ComposerThinkingReason | undefined = thinks
    ? undefined
    : option?.local
      ? 'on-device'
      : 'no-thinking';
  const provider = primary?.provider;
  const id = primary?.model;
  const model = useMemo(() => (provider && id ? { provider, model: id } : undefined), [provider, id]);
  // An unset level runs as off (models' client), so it reads as the model's lightest.
  const defaultReasoning = nearestThinkingLevel(
    agent?.override?.reasoning ?? primary?.reasoning ?? 'off',
    thinking,
  );

  return { models, thinking, model, defaultReasoning, pickedReasoning, setReasoning, reason };
}

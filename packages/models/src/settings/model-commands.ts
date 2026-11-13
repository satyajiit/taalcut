// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model settings changes as bus commands (app-wide, project null), so
 * Settings, ⌘K and the agent share one path with undo and an audit entry.
 * Each returns its inverse, computed from the state before the change. The
 * core owner registers them on the bus; `models.restore` is internal (the
 * inverse of useRecommended and of itself): ⌘K hides it and the bus refuses it
 * from people, so only undo and redo run it.
 */
import {
  defineCommand,
  MODEL_COMMANDS,
  ok,
  type AnyCommand,
  type AsyncResult,
  type CommandOutcome,
} from '@taalcut/core';
import { z } from 'zod';
import { ModuleIdSchema } from '../modules';
import { ModuleOverrideSchema } from '../registry/profile-schema';
import type { ModelProfiles, ProfileSelection } from '../registry/profiles';

const SelectionSchema = z.object({
  activeProfileId: z.string().min(1),
  overrides: z.partialRecord(ModuleIdSchema, ModuleOverrideSchema),
});

export interface ModelCommandsDeps {
  readonly profiles: ModelProfiles;
  /** What "Use recommended" picks: assessHardware(info).defaultProfileId. */
  readonly recommendedProfileId: () => string;
}

const app = () => null;

export function createModelCommands(deps: ModelCommandsDeps): readonly AnyCommand[] {
  const { profiles } = deps;
  const selection = (): ProfileSelection => {
    const state = profiles.state();
    return { activeProfileId: state.activeProfileId, overrides: state.overrides };
  };
  /**
   * Applies a change, answering with `inverse` when it saved. Every change passes the handler's
   * context on, so the store commits it with this command's audit row (undo and redo too).
   */
  const done = async (
    change: AsyncResult<void>,
    inverse: { name: string; payload: unknown },
  ): AsyncResult<CommandOutcome<null>> => {
    const applied = await change;
    return applied.ok ? ok({ result: null, inverse }) : applied;
  };
  const restoreTo = (before: ProfileSelection) => ({ name: MODEL_COMMANDS.restore, payload: before });

  return [
    defineCommand({
      name: MODEL_COMMANDS.setProfile,
      payload: z.object({ profileId: z.string().min(1) }),
      sideEffect: 'write',
      project: app,
      handle: ({ profileId }, context) => {
        const previous = profiles.state().activeProfileId;
        return done(profiles.setActiveProfile(profileId, context), {
          name: MODEL_COMMANDS.setProfile,
          payload: { profileId: previous },
        });
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.setModuleOverride,
      payload: z.object({ module: ModuleIdSchema, override: ModuleOverrideSchema }),
      sideEffect: 'write',
      project: app,
      handle: ({ module, override }, context) => {
        const previous = profiles.state().overrides[module];
        return done(
          profiles.setModuleOverride(module, override, context),
          previous
            ? { name: MODEL_COMMANDS.setModuleOverride, payload: { module, override: previous } }
            : { name: MODEL_COMMANDS.clearModuleOverride, payload: { module } },
        );
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.clearModuleOverride,
      payload: z.object({ module: ModuleIdSchema }),
      sideEffect: 'write',
      project: app,
      handle: ({ module }, context) => {
        const previous = profiles.state().overrides[module];
        return done(
          profiles.clearModuleOverride(module, context),
          previous
            ? { name: MODEL_COMMANDS.setModuleOverride, payload: { module, override: previous } }
            : { name: MODEL_COMMANDS.clearModuleOverride, payload: { module } },
        );
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.useRecommended,
      payload: z.object({}),
      sideEffect: 'write',
      project: app,
      handle: (_payload, context) => {
        const before = selection();
        return done(
          profiles.setSelection({ activeProfileId: deps.recommendedProfileId(), overrides: {} }, context),
          restoreTo(before),
        );
      },
    }),
    defineCommand({
      name: MODEL_COMMANDS.restore,
      payload: SelectionSchema,
      sideEffect: 'write',
      internal: true,
      project: app,
      handle: (target, context) => {
        const before = selection();
        return done(profiles.setSelection(target, context), restoreTo(before));
      },
    }),
  ];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for every TIMELINE_COMMANDS, BATCH_COMMANDS, EDITOR_COMMANDS and
 * AUDIO_EDIT_COMMANDS name and for music.choosePath, for the agent process's
 * bus (core SPEC 13: the timeline lane implements them).
 */
import { createCommitAnnouncer, type AnyCommand, type CommandBus, type EventBus } from '@taalcut/core';
import type { TimelineCommandDeps } from './context';
import { createAudioEditCommands } from './audio-edit-commands';
import { createBatchCommands } from './batch-commands';
import { createCleanupCommands } from './cleanup-commands';
import { createEditCommands } from './edit-commands';
import { createEditorCommands } from './editor-commands';
import { createEnergyCommands } from './energy-commands';
import { createGapCommands } from './gap-commands';
import { createInterchangeCommands } from './interchange-command';
import { createLifecycleCommands } from './lifecycle';
import { createReframeCommands } from './reframe-commands';
import { coverCommand } from './cover-command';
import { createSimpleEditorCommands } from './simple-editor-commands';
import { createStyleCommands } from './style-commands';

export interface TimelineCommands {
  /** Every handler, to register in one call: `bus.register(...commands.all)`. */
  readonly all: readonly AnyCommand[];
  readonly byName: ReadonlyMap<string, AnyCommand>;
  /**
   * Sends `library.changed` for each committed timeline command: call once with the bus the handlers are
   * registered on. Without it no timeline command announces anything. Returns the unsubscribe.
   */
  announce(bus: Pick<CommandBus, 'subscribe'>, events?: Pick<EventBus, 'emit'>): () => void;
}

export function createTimelineCommands(deps: TimelineCommandDeps): TimelineCommands {
  // library.changed once each command commits (core's commit announcer, round P3-3).
  const announcer = createCommitAnnouncer();
  const shared = { ...deps, announcer };
  // One family per file (SPEC, "Module layout"): a new capability adds a family here, never a switch arm.
  const all = [
    ...createLifecycleCommands(shared).all,
    ...createEditCommands(shared).all,
    ...createReframeCommands(shared).all,
    ...createInterchangeCommands(shared).all,
    ...createGapCommands(shared).all,
    ...createCleanupCommands(shared).all,
    ...createEnergyCommands(shared).all,
    ...createStyleCommands(shared).all,
    ...createBatchCommands(shared).all,
    // EDT1-OPS: the editor's full set of edits and the sound's.
    ...createEditorCommands(shared).all,
    ...createAudioEditCommands(shared).all,
    ...createSimpleEditorCommands(shared).all,
    coverCommand(shared),
  ] as AnyCommand[];
  return {
    all,
    byName: new Map(all.map((command) => [command.name, command])),
    announce: (bus, events = deps.events) => announcer.attach(bus, events),
  };
}

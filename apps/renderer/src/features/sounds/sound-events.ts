// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  EDITOR_COMMANDS,
  SETTINGS_COMMANDS,
  TIMELINE_COMMANDS,
  type DeviceRun,
  type EventOf,
  type ImportSession,
  type TransferFile,
} from '@taalcut/core';
import type { InterfaceSounds } from './sound-runtime';
import type { SoundPreference } from './sound-preference';
import { QUIET, transferCue, type TransferSoundState } from './transfer-sounds';

export const SOUND_EVENTS = [
  'command.changed',
  'agent.toolFinished',
  'render.finished',
  'transfer.file',
  'transfer.session',
  'transfer.deviceRun',
  'recovery.changed',
] as const;

const EDITS: ReadonlySet<string> = new Set([
  TIMELINE_COMMANDS.swapClip,
  TIMELINE_COMMANDS.trimClip,
  TIMELINE_COMMANDS.moveClip,
  TIMELINE_COMMANDS.editText,
  TIMELINE_COMMANDS.moveText,
  TIMELINE_COMMANDS.applyCast,
  TIMELINE_COMMANDS.fillGap,
  TIMELINE_COMMANDS.dropSlot,
  TIMELINE_COMMANDS.applyCleanup,
  TIMELINE_COMMANDS.applyEnergyCurve,
  TIMELINE_COMMANDS.setStyle,
  TIMELINE_COMMANDS.setReframe,
  TIMELINE_COMMANDS.setVisualLayout,
  EDITOR_COMMANDS.splitClip,
  EDITOR_COMMANDS.deleteClip,
  EDITOR_COMMANDS.insertClip,
  EDITOR_COMMANDS.duplicateClip,
  EDITOR_COMMANDS.setSpeed,
  EDITOR_COMMANDS.setTransition,
  EDITOR_COMMANDS.removeTransition,
  EDITOR_COMMANDS.setGrade,
  EDITOR_COMMANDS.slipClip,
]);

interface WifiBatch {
  files: Map<string, TransferFile>;
  state: TransferSoundState;
}

export function createSoundEventHandler(sounds: InterfaceSounds, preference: SoundPreference) {
  const wifi = new Map<string, WifiBatch>();
  const cable = new Map<string, DeviceRun['state']>();
  return (event: EventOf<(typeof SOUND_EVENTS)[number]>): void => {
    switch (event.type) {
      case 'command.changed': {
        const change = event.payload;
        if (
          change.name === SETTINGS_COMMANDS.setInterfaceSounds ||
          change.name === SETTINGS_COMMANDS.initializeInterfaceSounds
        ) {
          preference.changed();
          return;
        }
        if (!['ui', 'shortcut'].includes(change.source) || !change.projectId) return;
        if (change.kind === 'executed' ? !EDITS.has(change.name) : !/^(timeline|audio)\./.test(change.name))
          return;
        const cue = change.kind === 'undone' ? 'undo' : change.kind === 'redone' ? 'redo' : 'editApplied';
        sounds.play(cue, ['command', change.id, change.kind, event.at].join(':'));
        return;
      }
      case 'agent.toolFinished':
        if (event.payload.tool === 'timeline.assemble' && event.payload.status === 'succeeded')
          sounds.play('draftAssembled', 'assembly:' + event.payload.toolRunId);
        return;
      case 'render.finished':
        if (event.payload.status === 'ready') sounds.play('complete', 'render:' + event.payload.renderId);
        return;
      case 'transfer.file': {
        const file = event.payload;
        let batch = wifi.get(file.sessionId);
        if (!batch) {
          batch = { files: new Map(), state: QUIET };
          wifi.set(file.sessionId, batch);
        }
        batch.files.set(file.id, file);
        const next = transferCue(batch.state, [...batch.files.values()]);
        batch.state = next.state;
        if (next.cue) sounds.play(next.cue, ['wifi', file.sessionId, file.id, file.updatedAt].join(':'));
        if (!next.state.busy) wifi.delete(file.sessionId);
        return;
      }
      case 'transfer.session':
        if (event.payload.state === 'stopped') wifi.delete(event.payload.id);
        return;
      case 'transfer.deviceRun': {
        const run = event.payload;
        const before = cable.get(run.id);
        cable.set(run.id, run.state);
        if (cable.size > 512) cable.delete(cable.keys().next().value!);
        if (
          run.state === 'succeeded' &&
          (before === 'running' || before === 'paused') &&
          run.totals.imported > 0 &&
          run.totals.failed === 0 &&
          run.totals.rejected === 0
        )
          sounds.play('importDone', 'cable:' + run.id);
        return;
      }
      case 'recovery.changed':
        preference.changed();
    }
  };
}

/** The initial import snapshot describes history, not work completed in this renderer session. */
export function createImportSoundObserver(sounds: InterfaceSounds) {
  let previous: Map<string, ImportSession['status']> | null = null;
  return (sessions: readonly ImportSession[]): void => {
    const next = new Map<string, ImportSession['status']>();
    for (const session of sessions) {
      if (session.method === 'phone-wifi' || session.method === 'phone-cable') continue;
      next.set(session.id, session.status);
      const before = previous?.get(session.id);
      if (
        session.status === 'completed' &&
        (before === 'running' || before === 'paused') &&
        session.progress.completedItems + session.progress.archivedItems > 0 &&
        session.progress.failedItems === 0
      )
        sounds.play('importDone', ['import', session.id, session.finishedAt].join(':'));
    }
    previous = next;
  };
}

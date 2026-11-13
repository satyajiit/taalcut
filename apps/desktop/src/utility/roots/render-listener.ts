// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's SoundListener in the render process (EAR1-A2; render's QA soundOnCuts, soundClean and soundCritique): each
 * hearing is an `audio.listen.analyse` job in the jobs process, reached through main's runner as the export job's
 * child, so this process never opens an ONNX session (audio's createJobSoundListener). QA never starts a model
 * download: a model that isn't installed leaves realness and the critique's model rows out. Without a port to main
 * (tests, no jobs process) nothing is registered and the sound checks are skipped.
 */
import { SoundListenerToken, type Container, type JobRunner } from '@taalcut/core';
import { createJobSoundListener } from '@taalcut/audio';
import type { RenderEngineDeps } from '@taalcut/render';

export function registerSoundListener(
  container: Container,
  runner: Pick<JobRunner, 'run'> | undefined,
): void {
  if (!runner || container.has(SoundListenerToken)) return;
  container.value(SoundListenerToken, createJobSoundListener(runner, { install: false }));
}

/** The engine's `listener` when one is registered. */
export function renderListener(container: Container): Pick<RenderEngineDeps, 'listener'> {
  return container.has(SoundListenerToken) ? { listener: container.resolve(SoundListenerToken) } : {};
}

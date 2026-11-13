// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, newId, ok, toTaalcutError } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { createSoundActivity } from '../../src/features/sounds/sound-activity';
import {
  createVoiceRecorder,
  type MicrophoneInput,
  type OpenMicrophone,
  type VoiceCaptureApi,
} from '../../src/features/voice/voice-recorder';

function setup() {
  const activity = createSoundActivity();
  const capture: VoiceCaptureApi = {
    permission: vi.fn(async () => ok('granted' as const)),
    start: vi.fn(async () => ok({ captureId: 'capture' })),
    append: vi.fn(async () => ok(null)),
    stop: vi.fn(async () => ok({ captureKey: 'capture', durationMs: 100 })),
    cancel: vi.fn(async () => ok(null)),
  };
  const input = { projectId: newId<'Project'>(), onLevel: vi.fn(), onFailed: vi.fn() };
  return { activity, capture, input };
}

it('suppresses permission prompts and releases a rejected request', async () => {
  const { activity, capture } = setup();
  const pending = Promise.withResolvers<Awaited<ReturnType<VoiceCaptureApi['permission']>>>();
  capture.permission = () => pending.promise;
  const recorder = createVoiceRecorder({
    activity,
    capture,
    openMicrophone: vi.fn(),
  });
  const permission = recorder.permission();
  expect(activity.isBusy()).toBe(true);
  pending.reject(new Error('disconnected'));
  await expect(permission).rejects.toThrow('disconnected');
  expect(activity.isBusy()).toBe(false);
});

it('holds suppression from start through pending microphone closure', async () => {
  const { activity, capture, input } = setup();
  const closing = Promise.withResolvers<void>();
  const recorder = createVoiceRecorder({
    activity,
    capture,
    openMicrophone: async () => ok({ close: () => closing.promise }),
  });
  const pending = recorder.start(input);
  expect(activity.isBusy()).toBe(true);
  const started = await pending;
  if (!started.ok) throw new Error('did not start');
  const stopping = started.value.stop();
  expect(activity.isBusy()).toBe(true);
  closing.resolve();
  await stopping;
  expect(activity.isBusy()).toBe(false);
});

it('releases denied starts, failed microphone opening and thrown opening requests', async () => {
  const { activity, capture, input } = setup();
  const error = toTaalcutError(new Error('unavailable'));
  capture.start = async () => err(error);
  const openMicrophone = vi.fn<OpenMicrophone>(async () => err(error));
  const recorder = createVoiceRecorder({ activity, capture, openMicrophone });
  expect((await recorder.start(input)).ok).toBe(false);
  expect(activity.isBusy()).toBe(false);
  expect(openMicrophone).not.toHaveBeenCalled();
  capture.start = async () => ok({ captureId: 'capture' });
  expect((await recorder.start(input)).ok).toBe(false);
  expect(activity.isBusy()).toBe(false);
  openMicrophone.mockRejectedValueOnce(new Error('opening failed'));
  await expect(recorder.start(input)).rejects.toThrow('opening failed');
  expect(activity.isBusy()).toBe(false);
});

it('keeps a device lost during opening quiet until its late handle is closed', async () => {
  const { activity, capture, input } = setup();
  const opened = Promise.withResolvers<Awaited<ReturnType<OpenMicrophone>>>();
  const closing = Promise.withResolvers<void>();
  const microphone: MicrophoneInput = { close: vi.fn(() => closing.promise) };
  const recorder = createVoiceRecorder({
    activity,
    capture,
    openMicrophone: (_samples, onEnded) => {
      onEnded();
      return opened.promise;
    },
  });
  const pending = recorder.start(input);
  await Promise.resolve();
  expect(input.onFailed).toHaveBeenCalledOnce();
  expect(activity.isBusy()).toBe(true);
  opened.resolve(ok(microphone));
  await Promise.resolve();
  expect(microphone.close).toHaveBeenCalledOnce();
  expect(activity.isBusy()).toBe(true);
  closing.resolve();
  expect((await pending).ok).toBe(false);
  expect(activity.isBusy()).toBe(false);
});

it('releases cancellation without removing another active recording token', async () => {
  const { activity, capture, input } = setup();
  const releaseOther = activity.acquire('recording');
  const recorder = createVoiceRecorder({
    activity,
    capture,
    openMicrophone: async () => ok({ close: async () => undefined }),
  });
  const started = await recorder.start(input);
  if (!started.ok) throw new Error('did not start');
  await started.value.cancel();
  expect(activity.isBusy()).toBe(true);
  releaseOther();
  expect(activity.isBusy()).toBe(false);
});

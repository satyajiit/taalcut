// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The window's microphone for a voice consent: getUserMedia (mono, no echo cancelling, noise suppression or gain
 * control, so the recording is the voice as it is), an AudioContext at 48 kHz and the pcm-tap worklet, which hands
 * the samples over in blocks. Closing stops the tracks and the context. Main decides the macOS permission first
 * (voiceCapture.permission); Electron's permission handler must grant this window 'media'.
 */
import { err, ok, toTaalcutError } from '@taalcut/core';
import pcmTapUrl from './pcm-tap.worklet.ts?worker&url';
import { CAPTURE_SAMPLE_RATE } from './pcm';
import type { OpenMicrophone } from './voice-recorder';

export const openBrowserMicrophone: OpenMicrophone = async (onSamples, onEnded) => {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
  const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
  const stop = async () => {
    for (const track of stream.getTracks()) track.stop();
    if (context.state !== 'closed') await context.close();
  };
  try {
    await context.audioWorklet.addModule(pcmTapUrl);
  } catch (cause) {
    await stop();
    return err(toTaalcutError(cause));
  }
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, 'pcm-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  tap.port.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data instanceof Float32Array) onSamples(event.data);
  };
  source.connect(tap);
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', onEnded);
  return ok({
    async close() {
      tap.port.onmessage = null;
      for (const track of stream.getAudioTracks()) track.removeEventListener('ended', onEnded);
      source.disconnect();
      await stop();
    },
  });
};

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { toTaalcutError, type ProjectId, type TaalcutError } from '@taalcut/core';
import type { CardVoiceRecording, MicrophonePermission } from '@taalcut/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useSoundActivity } from '../sounds/sound-activity-context';
import { openBrowserMicrophone } from './microphone';
import { recordingPreview } from './recording-preview';
import { voiceCaptureApi } from './use-voice-capture';
import { createVoiceRecorder } from './voice-recorder';

type Take = { captureKey: string; durationMs: number; url: string };
type RecorderPhase = 'idle' | 'countdown' | 'opening' | 'recording' | 'stopping' | 'ready';
export function useNarrationRecorder(projectId: ProjectId) {
  const backend = useBackend();
  const activity = useSoundActivity();
  const releaseActivity = useRef<(() => void) | undefined>(undefined);
  const api = useMemo(() => voiceCaptureApi(backend), [backend]);
  const samples = useRef<Float32Array[]>([]);
  const current = useRef<CardVoiceRecording | null>(null);
  const mounted = useRef(true),
    generation = useRef(0),
    limit = useRef(0);
  const kept = useRef<Take | null>(null);
  const [phase, updatePhase] = useState<RecorderPhase>('idle');
  const setPhase = useCallback(
    (next: RecorderPhase) => {
      if (next === 'idle' || next === 'ready') {
        releaseActivity.current?.();
        releaseActivity.current = undefined;
      } else releaseActivity.current ??= activity.acquire('recording');
      updatePhase(next);
    },
    [activity],
  );
  const [count, setCount] = useState(3),
    [level, setLevel] = useState(0),
    [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [permission, setPermission] = useState<MicrophonePermission | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const recorder = useMemo(
    () =>
      createVoiceRecorder({
        capture: api,
        openMicrophone: openBrowserMicrophone,
        activity,
        onSamples: (chunk) => samples.current.push(chunk.slice()),
      }),
    [api, activity],
  );
  const valid = (token: number) => mounted.current && token === generation.current;
  const discard = async (saved: Take | null) => {
    if (!saved) return;
    URL.revokeObjectURL(saved.url);
    await api.cancel({ captureId: saved.captureKey });
  };
  const reset = async () => {
    const token = ++generation.current;
    const recording = current.current;
    current.current = null;
    const saved = kept.current;
    kept.current = null;
    try {
      await recording?.cancel();
      await discard(saved);
    } finally {
      if (valid(token)) {
        releaseActivity.current?.();
        releaseActivity.current = undefined;
      }
    }
    if (!valid(token)) return;
    samples.current = [];
    setTake(null);
    setLevel(0);
    setElapsed(0);
    setPhase('idle');
    setError(null);
  };
  const stop = async () => {
    const recording = current.current,
      token = generation.current;
    if (!recording) return;
    current.current = null;
    setPhase('stopping');
    try {
      const done = await recording.stop();
      if (!valid(token)) {
        if (done.ok) await api.cancel({ captureId: done.value.captureKey });
        return;
      }
      if (!done.ok) {
        setError(done.error);
        setPhase('idle');
        return;
      }
      const saved = { ...done.value, url: URL.createObjectURL(recordingPreview(samples.current)) };
      kept.current = saved;
      samples.current = [];
      setTake(saved);
      setPhase('ready');
      setLevel(0);
    } catch (cause) {
      if (valid(token)) {
        setError(toTaalcutError(cause));
        setPhase('idle');
      }
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      releaseActivity.current?.();
      releaseActivity.current = undefined;
      void current.current?.cancel();
      const saved = kept.current;
      if (saved) {
        URL.revokeObjectURL(saved.url);
        void api.cancel({ captureId: saved.captureKey });
      }
    };
  }, [api]);
  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = setTimeout(() => {
      if (count > 1) {
        setCount(count - 1);
        return;
      }
      setPhase('opening');
      const token = generation.current;
      let reached = false;
      void recorder
        .start({
          projectId,
          maxSamples: limit.current,
          onLimit: () => {
            reached = true;
            void stopRef.current();
          },
          onLevel: (value) => {
            if (valid(token)) setLevel(value);
          },
          onFailed: (failure) => {
            if (valid(token)) {
              setError(failure);
              setPhase('idle');
              current.current = null;
            }
          },
        })
        .then((started) => {
          if (!valid(token)) {
            if (started.ok) void started.value.cancel();
            return;
          }
          if (started.ok) {
            current.current = started.value;
            setPhase('recording');
            if (reached) void stopRef.current();
          } else {
            setError(started.error);
            setPhase('idle');
          }
        })
        .catch((cause: unknown) => {
          if (valid(token)) {
            setError(toTaalcutError(cause));
            setPhase('idle');
          }
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [phase, count, recorder, projectId, setPhase]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - started), 100);
    return () => clearInterval(timer);
  }, [phase]);
  const start = async (maxMs: number) => {
    await reset();
    const token = generation.current;
    if (!mounted.current || maxMs <= 0) return;
    limit.current = Math.floor(Math.min(599_000, maxMs) * 48);
    setPhase('opening');
    let allowed: Awaited<ReturnType<typeof recorder.permission>>;
    try {
      allowed = await recorder.permission();
    } catch (cause) {
      if (valid(token)) {
        setError(toTaalcutError(cause));
        setPhase('idle');
      }
      return;
    }
    if (!valid(token)) return;
    if (!allowed.ok) {
      setError(allowed.error);
      setPhase('idle');
      return;
    }
    setPermission(allowed.value);
    if (allowed.value !== 'granted') {
      setPhase('idle');
      return;
    }
    setCount(3);
    setPhase('countdown');
  };
  return { phase, count, level, elapsed, error, permission, take, start, stop, reset };
}

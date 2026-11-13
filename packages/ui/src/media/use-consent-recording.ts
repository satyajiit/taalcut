// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice consent card's own steps (P3-B6, U-4): the card arrives in a status from the agent, and what the person
 * does in it moves it on here: Start asks for the microphone and records, Stop finishes the file and dispatches
 * voice.recordConsent (the check runs on this Mac), then Create my voice (voice.createClone) or Withdraw
 * (voice.withdrawConsent). A new status from the agent starts over from it.
 */
import type { CardOf, TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONSENT_RECORDING_MS, CREATE_CLONE, RECORD_CONSENT, WITHDRAW_CONSENT } from './media-commands';
import { useMediaActions, type CardVoiceRecording, type MicrophonePermission } from './media-actions';

type Card = CardOf<'voiceConsent'>;
/** The card's statuses, and `withdrawn` once the person withdrew here. */
export type ConsentStatus = Card['status'] | 'withdrawn';
export type ConsentBusy = 'start' | 'stop' | 'cancel' | 'clone' | 'withdraw' | null;

export interface ConsentRecording {
  readonly status: ConsentStatus;
  readonly busy: ConsentBusy;
  readonly error: TaalcutError | null;
  /** What the check heard, on a mismatch (untrusted). */
  readonly heard: string | null;
  /** Null until Start asked. */
  readonly permission: MicrophonePermission | null;
  readonly elapsedMs: number;
  readonly speakerName: string;
  /** The name the voice was made under here. */
  readonly voiceName: string | null;
  /** The app can record here (the microphone member is there). */
  readonly canRecord: boolean;
  /** The app can dispatch the consent commands. */
  readonly canDispatch: boolean;
  setSpeakerName(name: string): void;
  /** The level meter's feed: called with 0 to 1 while recording. Returns the unsubscribe. */
  subscribeLevel(listener: (level: number) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  recordAgain(): void;
  createVoice(name: string): Promise<boolean>;
  withdraw(): Promise<boolean>;
}

const isMismatch = (error: TaalcutError) => error.code === 'audio.consent_mismatch';
const isLength = (error: TaalcutError) => error.code === 'audio.consent_recording_length';
const heardOf = (error: TaalcutError) => {
  const heard = error.params?.['heard'];
  return typeof heard === 'string' ? heard : null;
};

export function useConsentRecording(card: Card): ConsentRecording {
  const { voiceCapture, dispatch } = useMediaActions();
  const [local, setLocal] = useState<ConsentStatus | null>(null);
  const [busy, setBusy] = useState<ConsentBusy>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicrophonePermission | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [speakerName, setSpeakerName] = useState('');
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const recording = useRef<CardVoiceRecording | null>(null);
  const listeners = useRef(new Set<(level: number) => void>());
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  // A new status from the agent is the card's state from now on.
  useEffect(() => {
    setLocal(null);
    setError(null);
  }, [card.status]);

  const status: ConsentStatus = local ?? card.status;
  const elapsedMs = startedAt === null ? 0 : Math.max(0, now - startedAt);

  // The clock while recording; past ten minutes the recording stops itself (main takes no more).
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  useEffect(() => {
    if (startedAt !== null && elapsedMs >= CONSENT_RECORDING_MS.max) void stopRef.current();
  }, [elapsedMs, startedAt]);

  // Leaving the card while recording drops the recording.
  useEffect(
    () => () => {
      void recording.current?.cancel();
      recording.current = null;
    },
    [],
  );

  const subscribeLevel = useCallback((listener: (level: number) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const ended = useCallback(() => {
    recording.current = null;
    setStartedAt(null);
    for (const listener of listeners.current) listener(0);
  }, []);

  const start = useCallback(async () => {
    if (!voiceCapture) return;
    setBusy('start');
    setError(null);
    setHeard(null);
    const allowed = await voiceCapture.permission();
    if (!allowed.ok) {
      setBusy(null);
      setError(allowed.error);
      return;
    }
    setPermission(allowed.value);
    if (allowed.value !== 'granted') {
      setBusy(null);
      return;
    }
    const started = await voiceCapture.start({
      consentId: card.consentId,
      onLevel: (level) => {
        for (const listener of listeners.current) listener(level);
      },
      onFailed: (cause) => {
        ended();
        setError(cause);
        setLocal('failed');
      },
    });
    setBusy(null);
    if (!started.ok) {
      setError(started.error);
      return;
    }
    recording.current = started.value;
    const at = Date.now();
    setNow(at);
    setStartedAt(at);
    setLocal('recording');
  }, [card.consentId, ended, voiceCapture]);

  const check = useCallback(
    async (captureKey: string) => {
      if (!dispatch) return;
      setLocal('checking');
      const recorded = await dispatch(RECORD_CONSENT, {
        projectId: null,
        consentId: card.consentId,
        captureKey,
        speakerName: speakerName.trim(),
        language: card.language,
        termsVersion: card.termsVersion,
      });
      if (recorded.ok) return setLocal('stored');
      if (isMismatch(recorded.error)) {
        setHeard(heardOf(recorded.error));
        return setLocal('mismatch');
      }
      setError(recorded.error);
      setLocal(isLength(recorded.error) ? 'ready' : 'failed');
    },
    [card.consentId, card.language, card.termsVersion, dispatch, speakerName],
  );

  const stop = useCallback(async () => {
    const current = recording.current;
    if (!current) return;
    setBusy('stop');
    const stopped = await current.stop();
    ended();
    setBusy(null);
    if (!stopped.ok) {
      setError(stopped.error);
      setLocal('failed');
      return;
    }
    await check(stopped.value.captureKey);
  }, [check, ended]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const cancel = useCallback(async () => {
    const current = recording.current;
    setBusy('cancel');
    if (current) await current.cancel();
    ended();
    setBusy(null);
    setLocal('ready');
  }, [ended]);

  const recordAgain = useCallback(() => {
    setError(null);
    setHeard(null);
    setLocal('ready');
  }, []);

  const createVoice = useCallback(
    async (name: string) => {
      if (!dispatch) return false;
      setBusy('clone');
      setError(null);
      const made = await dispatch(CREATE_CLONE, {
        projectId: null,
        consentId: card.consentId,
        name: name.trim(),
      });
      setBusy(null);
      if (!made.ok) {
        setError(made.error);
        return false;
      }
      setVoiceName(name.trim());
      setLocal('cloned');
      return true;
    },
    [card.consentId, dispatch],
  );

  const withdraw = useCallback(async () => {
    if (!dispatch) return false;
    setBusy('withdraw');
    setError(null);
    const withdrawn = await dispatch(WITHDRAW_CONSENT, { projectId: null, consentId: card.consentId });
    setBusy(null);
    if (!withdrawn.ok) {
      setError(withdrawn.error);
      return false;
    }
    setLocal('withdrawn');
    return true;
  }, [card.consentId, dispatch]);

  return {
    status,
    busy,
    error,
    heard: heard ?? card.heard ?? null,
    permission,
    elapsedMs,
    speakerName,
    voiceName,
    canRecord: voiceCapture !== undefined && dispatch !== undefined,
    canDispatch: dispatch !== undefined,
    setSpeakerName,
    subscribeLevel,
    start,
    stop,
    cancel,
    recordAgain,
    createVoice,
    withdraw,
  };
}

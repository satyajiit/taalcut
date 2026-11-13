// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ContactChipId } from '#content/contact';
import { contactEntry, contactProblems, type ContactField, type ContactProblem } from '#lib/firebase/entries';
import { submitContact } from '#lib/firebase/load';
import type { WriteCause } from '#lib/firebase/outcome';
import { storedTopic } from './topics';

export type ContactStatus = 'idle' | 'invalid' | 'submitting' | 'success' | 'error' | 'offline';

/** The shortest the sending state shows, so a fast answer doesn't flash "Sending…" and Kaatu's thinking. */
const MIN_BUSY_MS = 450;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ContactValues {
  readonly name: string;
  readonly email: string;
  readonly message: string;
}

/** One field's problem as the values stand, or null when it's a good answer. Pure, for the test. */
export function fieldProblem(field: ContactField, values: ContactValues): ContactProblem | null {
  return contactProblems(values).find(([f]) => f === field)?.[1] ?? null;
}

/**
 * The contact thread's send, the way a direct message works: a valid message posts as your bubble at once (the
 * composer empties), its receipt reads "Sending…", then "Sent" or what went wrong with Try again, which resends that
 * bubble with the name and address as they are now. A field's problem stays on its field and posts nothing.
 */
export function useContactSend({
  chip,
  fields,
}: {
  readonly chip: ContactChipId | null;
  readonly fields: Readonly<Record<ContactField, RefObject<HTMLInputElement | HTMLTextAreaElement | null>>>;
}) {
  const [values, setValues] = useState<ContactValues>({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<ContactStatus>('idle');
  const [problems, setProblems] = useState<Partial<Record<ContactField, ContactProblem>>>({});
  const [cause, setCause] = useState<WriteCause | null>(null);
  /** The message posted as your bubble: sending, sent or not sent. */
  const [posted, setPosted] = useState<string | null>(null);
  const busy = useRef(false);

  const update = useCallback((field: ContactField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Typing clears that field's problem: a field never scolds while someone is still writing.
    setProblems((now) => {
      if (!now[field]) return now;
      const { [field]: _gone, ...rest } = now;
      return rest;
    });
  }, []);

  /** Sends the composer's message, or, from Try again, the bubble that didn't go. */
  const send = useCallback(
    async (again?: string) => {
      if (busy.current) return;
      const message = again ?? values.message;
      const found = contactProblems({ ...values, message });
      if (found.length > 0) {
        setProblems(Object.fromEntries(found));
        setStatus('invalid');
        fields[found[0]![0]].current?.focus();
        return;
      }
      const entry = contactEntry({ ...values, message, topic: storedTopic(chip) });
      if (!entry) return;
      busy.current = true;
      setPosted(message);
      setValues((v) => ({ ...v, message: '' }));
      setCause(null);
      setStatus('submitting');
      const [outcome] = await Promise.all([submitContact(entry), wait(MIN_BUSY_MS)]);
      busy.current = false;
      if (outcome.kind === 'ok') setStatus('success');
      else if (outcome.kind === 'offline') setStatus('offline');
      else {
        setCause(outcome.cause);
        setStatus('error');
      }
    },
    [chip, fields, values],
  );

  /** Answers one reply (Return in your name or address): true when it's good; otherwise its problem shows on it. */
  const check = useCallback(
    (field: ContactField) => {
      const problem = fieldProblem(field, values);
      if (problem) setProblems((now) => ({ ...now, [field]: problem }));
      return problem === null;
    },
    [values],
  );

  /** After a sent message: an empty thread end and composer, the name and address kept. */
  const reset = useCallback(() => {
    setPosted(null);
    setStatus('idle');
  }, []);

  return { values, update, send, check, reset, status, problems, cause, posted };
}

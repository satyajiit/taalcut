// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Share dialog's state (P3-B12, U3): the form, hub.shareCheck on it (debounced, so the problems follow the
 * typing), the CC0 tick with when it was given, and hub.publish, a person's command, with that time. A build without
 * the hub or Local only is refused up front, as hub.publish would refuse it.
 */
import {
  callRpc,
  HUB_COMMANDS,
  HubNotConfigured,
  LocalOnly,
  type HubShareForm,
  type HubTemplateV0,
  type TaalcutError,
  type Template,
  type TemplateSummary,
} from '@taalcut/core';
import { isHandle, type ShareProblem, type ShareStatus } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { noteHubRefusal } from './hub-limits';

/** The handle the last share used, until hub.status carries the hub.handle setting (core request). */
const HANDLE_KEY = 'taalcut.hub.handle';

function rememberedHandle(): string {
  try {
    return window.localStorage.getItem(HANDLE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberHandle(handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // Storage blocked: the handle is asked for again next time.
  }
}

/** Waits this long after the last change before checking again. */
const CHECK_AFTER_MS = 300;

export function useShareFlow(summary: TemplateSummary, template: Template) {
  const backend = useBackend();
  const [form, setForm] = useState<HubShareForm>(() => ({
    name: summary.name.slice(0, 80),
    description: '',
    handle: rememberedHandle(),
    tags: [],
    language: template.language,
    includeStyle: false,
  }));
  const [document, setDocument] = useState<HubTemplateV0 | null>(null);
  const [problems, setProblems] = useState<readonly ShareProblem[]>([]);
  const [status, setStatus] = useState<ShareStatus>('checking');
  const [error, setError] = useState<TaalcutError | null>(null);
  const [acknowledgedAt, setAcknowledgedAt] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<TaalcutError | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    void callRpc(backend.hub.status()).then((read) => {
      if (!current || !read.ok) return;
      if (read.value.localOnly) setBlocked(LocalOnly({ what: 'hub' }));
      else if (!read.value.configured) setBlocked(HubNotConfigured());
      else setBlocked(null);
    });
    return () => {
      current = false;
    };
  }, [backend]);

  useEffect(() => {
    setStatus((now) => (now === 'sent' ? now : 'checking'));
    let current = true;
    const timer = setTimeout(() => {
      // The check builds the document from the structure: a half-typed handle or name is the form's own line,
      // so the check runs with stand-ins the hub would take until they are filled in.
      const checked = {
        ...form,
        handle: isHandle(form.handle) ? form.handle : 'you',
        name: form.name.trim() || summary.name.slice(0, 80) || 'Template',
      };
      void callRpc(
        backend.hub.shareCheck({ templateId: template.id, version: template.version, form: checked }),
      ).then((result) => {
        if (!current) return;
        if (result.ok) {
          setDocument(result.value.document);
          setProblems(result.value.problems);
          setError(null);
          setStatus((now) => (now === 'sent' ? now : 'ready'));
        } else {
          setError(result.error);
          setStatus('refused');
        }
      });
    }, CHECK_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [backend, form, template.id, template.version, summary.name, round]);

  const submit = async () => {
    if (acknowledgedAt === null) return;
    setStatus('sending');
    setError(null);
    const sent = await callRpc(
      backend.commands.dispatch({
        name: HUB_COMMANDS.publish,
        payload: {
          projectId: null,
          templateId: template.id,
          version: template.version,
          form,
          acknowledgedAt,
        },
        source: 'ui',
      }),
    );
    if (sent.ok) {
      rememberHandle(form.handle);
      setStatus('sent');
      return;
    }
    noteHubRefusal(sent.error);
    setError(sent.error);
    setStatus('refused');
    // The hub's problems changed under us: check again so the list shows them.
    if (sent.error.code === 'hub.invalid') setRound((n) => n + 1);
  };

  return {
    form,
    setForm,
    document,
    problems,
    status: blocked && status !== 'sent' && status !== 'sending' ? ('refused' as const) : status,
    error: blocked ?? error,
    acknowledged: acknowledgedAt !== null,
    acknowledge: (on: boolean) => setAcknowledgedAt(on ? Date.now() : null),
    submit,
  };
}

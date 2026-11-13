// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- bundle paths and ids: data, never UI copy */

/**
 * Send feedback's fake (appContract.feedback, main in the app): the bundle
 * preview by section with sizes and what was redacted, sending (refused while
 * Local only is on, as main does with core.local_only) and saving a bundle.
 * Tests read `sent` and `saved`.
 */
import {
  LocalOnly,
  newId,
  toRpcError,
  type DebugCollectOptions,
  type DEBUG_SECTIONS,
  type PROCESS_NAMES,
} from '@taalcut/core';

type Section = (typeof DEBUG_SECTIONS)[number];

interface PreviewSection {
  section: Section;
  process: (typeof PROCESS_NAMES)[number];
  path: string;
  mediaType: 'application/json' | 'application/x-ndjson' | 'text/plain';
  bytes: number;
  redactions: { text: number; paths: number; secrets: number };
}

export interface FakeFeedback {
  preview(options: DebugCollectOptions): { sections: PreviewSection[]; totalBytes: number };
  send(input: { message: string; bundle: DebugCollectOptions | null }): { id: string };
  saveBundle(options: DebugCollectOptions): { saved: boolean; fileName?: string };
  readonly sent: { message: string; bundle: DebugCollectOptions | null }[];
  readonly saved: DebugCollectOptions[];
}

const KB = 1024;

export function createFakeFeedback(deps: { localOnly: () => boolean }): FakeFeedback {
  const sent: FakeFeedback['sent'] = [];
  const saved: DebugCollectOptions[] = [];
  const preview = (options: DebugCollectOptions) => {
    // With the chat's words left in, the runs are bigger and nothing in them is replaced by a hash.
    const text = options.includeChatText;
    const sections: PreviewSection[] = [
      {
        section: 'environment',
        process: 'main',
        path: 'main/environment.json',
        mediaType: 'application/json',
        bytes: 3 * KB,
        redactions: { text: 0, paths: 4, secrets: 0 },
      },
      {
        section: 'logs',
        process: 'main',
        path: 'main/logs/main.log',
        mediaType: 'text/plain',
        bytes: 182 * KB,
        redactions: { text: 0, paths: 37, secrets: 1 },
      },
      {
        section: 'runs',
        process: 'agent',
        path: 'agent/runs/last-10.jsonl',
        mediaType: 'application/x-ndjson',
        bytes: (text ? 412 : 96) * KB,
        redactions: { text: text ? 0 : 214, paths: 22, secrets: 0 },
      },
      {
        section: 'traces',
        process: 'agent',
        path: 'agent/traces/spans.jsonl',
        mediaType: 'application/x-ndjson',
        bytes: 64 * KB,
        redactions: { text: 0, paths: 0, secrets: 0 },
      },
      {
        section: 'cloudCalls',
        process: 'agent',
        path: 'agent/cloud-calls.json',
        mediaType: 'application/json',
        bytes: 12 * KB,
        redactions: { text: 0, paths: 0, secrets: 0 },
      },
      {
        section: 'jobs',
        process: 'jobs',
        path: 'jobs/jobs.json',
        mediaType: 'application/json',
        bytes: 21 * KB,
        redactions: { text: 0, paths: 58, secrets: 0 },
      },
    ];
    return { sections, totalBytes: sections.reduce((sum, section) => sum + section.bytes, 0) };
  };
  return {
    preview,
    send(input) {
      if (deps.localOnly()) throw toRpcError(LocalOnly({ what: 'feedback' }));
      sent.push(input);
      return { id: newId<'Feedback'>() };
    },
    saveBundle(options) {
      saved.push(options);
      return { saved: true, fileName: 'Taalcut feedback 2026-10-13.zip' };
    },
    sent,
    saved,
  };
}

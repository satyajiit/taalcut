// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Help → Send feedback. Its own consent: it works while crash reports are
 * off, and Local only refuses the send. The bundle is scanned before anything
 * is posted or written. No DSN still allows saving.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  LocalOnly,
  UnknownError,
  err,
  feedbackContract,
  implementContract,
  ok,
  unwrapRpc,
  type DebugCollectOptions,
  type DebugSection,
  type Result,
} from '@taalcut/core';
import { scrubSecrets } from '@taalcut/models';
import { applyKnownSecrets, replaceHome } from '../crash/text-shapes';
import { envelopeHeader, envelopeItem, postEnvelope, sentryUrls } from '../crash/envelope';
import { toWire } from '../../shared/wire';
import type { PackedDebugBundle } from './assemble';
import { FeedbackUnavailable } from './errors';

export interface FeedbackDeps {
  readonly dsn: string;
  readonly localOnly: () => boolean;
  readonly build: (options: DebugCollectOptions) => Promise<PackedDebugBundle>;
  readonly scan: (sections: readonly DebugSection[]) => Result<void>;
  readonly choose: (defaultName: string) => Promise<string | null>;
  readonly version: string;
  readonly channel: string;
  readonly secrets?: readonly string[];
  readonly homeDir?: string;
  readonly now?: () => number;
  readonly post?: (url: string, body: Buffer) => Promise<number>;
}

export interface FeedbackPreview {
  readonly sections: Array<Omit<DebugSection, 'text'> & { readonly bytes: number }>;
  readonly totalBytes: number;
}

export function createFeedback(deps: FeedbackDeps) {
  const now = () => deps.now?.() ?? Date.now();
  return {
    async preview(options: DebugCollectOptions): Promise<Result<FeedbackPreview>> {
      const built = await build(deps, options);
      if (!built.ok) return built;
      return ok({
        sections: built.value.sections.map(({ text: _text, ...section }) => ({
          ...section,
          bytes: Buffer.byteLength(_text),
        })),
        totalBytes: built.value.totalBytes,
      });
    },
    async send(input: {
      message: string;
      bundle: DebugCollectOptions | null;
    }): Promise<Result<{ id: string }>> {
      if (deps.localOnly()) return err(LocalOnly({ what: 'feedback' }));
      const attachment = await attachmentFor(deps, input.bundle);
      if (!attachment.ok) return attachment;
      const urls = sentryUrls(deps.dsn);
      if (!urls) return err(FeedbackUnavailable());
      const eventId = randomBytes(16).toString('hex');
      const body = feedbackEnvelope(deps, input.message, eventId, now(), attachment.value);
      const status = deps.post
        ? await deps.post(urls.envelopeUrl, body)
        : (await postEnvelope(urls.envelopeUrl, body)).status;
      if (status < 200 || status >= 300) return err(UnknownError(undefined, { detail: `status ${status}` }));
      return ok({ id: eventId });
    },
    async saveBundle(options: DebugCollectOptions): Promise<Result<{ saved: boolean; fileName?: string }>> {
      const built = await build(deps, options);
      if (!built.ok) return built;
      const scanned = deps.scan(built.value.sections);
      if (!scanned.ok) return scanned;
      const chosen = await deps.choose(built.value.fileName);
      if (!chosen) return ok({ saved: false });
      writePrivate(chosen, built.value.gzip);
      return ok({ saved: true, fileName: basename(chosen) });
    },
  };
}

export function feedbackRouter(deps: FeedbackDeps) {
  const service = createFeedback(deps);
  const os = implementContract(feedbackContract);
  return os.router({
    preview: os.preview.handler(async ({ input }) => toWire(unwrapRpc(await service.preview(input)))),
    send: os.send.handler(async ({ input }) => toWire(unwrapRpc(await service.send(input)))),
    saveBundle: os.saveBundle.handler(async ({ input }) =>
      toWire(unwrapRpc(await service.saveBundle(input))),
    ),
  });
}

/** Round-trip helper for tests that read a saved bundle. */
export function readSavedBundle(bytes: Buffer): unknown {
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

async function attachmentFor(
  deps: FeedbackDeps,
  options: DebugCollectOptions | null,
): Promise<Result<{ filename: string; gzip: Buffer } | undefined>> {
  if (!options) return ok(undefined);
  const built = await build(deps, options);
  if (!built.ok) return built;
  const scanned = deps.scan(built.value.sections);
  if (!scanned.ok) return scanned;
  return ok({ filename: built.value.fileName, gzip: built.value.gzip });
}

async function build(deps: FeedbackDeps, options: DebugCollectOptions): Promise<Result<PackedDebugBundle>> {
  try {
    return ok(await deps.build(options));
  } catch {
    return err(UnknownError(undefined, { detail: 'debug bundle build failed' }));
  }
}

function feedbackEnvelope(
  deps: FeedbackDeps,
  message: string,
  eventId: string,
  now: number,
  attachment: { filename: string; gzip: Buffer } | undefined,
): Buffer {
  const payload = Buffer.from(
    JSON.stringify({
      event_id: eventId,
      timestamp: now / 1000,
      platform: 'javascript',
      level: 'info',
      release: `taalcut@${deps.version}`,
      environment: deps.channel.length > 0 ? deps.channel : 'stable',
      contexts: { feedback: { message: scrubMessage(message, deps) } },
    }),
  );
  const parts = [
    envelopeHeader(eventId, new Date(now).toISOString(), deps.dsn),
    envelopeItem({ type: 'feedback', content_type: 'application/json' }, payload),
  ];
  if (attachment) {
    parts.push(
      envelopeItem(
        {
          type: 'attachment',
          content_type: 'application/gzip',
          filename: attachment.filename,
          attachment_type: 'event.attachment',
        },
        attachment.gzip,
      ),
    );
  }
  return Buffer.concat(parts);
}

function scrubMessage(message: string, deps: FeedbackDeps): string {
  const known = applyKnownSecrets(message, deps.secrets ?? []).text;
  return replaceHome(scrubSecrets(known), deps.homeDir ?? '').text;
}

function writePrivate(file: string, bytes: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, bytes, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  chmodSync(file, 0o600);
}

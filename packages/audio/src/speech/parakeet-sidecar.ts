// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parakeet on media's JSON-line mac-helper client. `--models` is the
 * installed int8 component directory (`parakeet-tdt-0-6b-v3-coreml`).
 * This file does not frame stdio lines; `createJsonLineSidecar` does.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import {
  createJsonLineSidecar,
  type JsonLineSidecar,
  type JsonLineSidecarOptions,
  type JsonValue,
} from '@taalcut/media';
import type { SpeechSidecar } from './engine';

export interface ParakeetSidecarOptions {
  readonly command: string;
  /** Installed int8 Parakeet component folder, passed as `--models`. */
  readonly modelsDir: string;
  /** Directories the helper may read. Transcribe paths must sit under one. */
  readonly allowRoots: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Idle exit in milliseconds. Default 120s. `0` leaves the process up. */
  readonly idleExitMs?: number;
}

const CANCELLED = new Set(['core.cancelled', 'helper.cancelled', 'media.cancelled']);

/** `serve` argv for the ASR service. Idle exit is added by the JSON-line client. */
export function parakeetServeArgs(modelsDir: string, allowRoots: readonly string[]): string[] {
  return [
    'serve',
    '--services',
    'asr',
    '--models',
    modelsDir,
    ...allowRoots.flatMap((root) => ['--allow-root', root]),
  ];
}

/**
 * Adapts media's sidecar to `SpeechSidecar`. Helper codes stay on `error.code`
 * so `asr.model_load_failed` and `asr.model_missing` still select the fallback.
 */
export function speechSidecarFromJsonLine(sidecar: JsonLineSidecar): SpeechSidecar {
  return {
    request(method, params, options) {
      return requestSpeech(sidecar, method, params, options);
    },
  };
}

export function createParakeetSidecar(
  options: ParakeetSidecarOptions,
  open: (options: JsonLineSidecarOptions) => JsonLineSidecar = createJsonLineSidecar,
): SpeechSidecar {
  return speechSidecarFromJsonLine(
    open({
      command: options.command,
      args: parakeetServeArgs(options.modelsDir, options.allowRoots),
      ...(options.env ? { env: options.env } : {}),
      idleExitMs: options.idleExitMs ?? 120_000,
    }),
  );
}

async function requestSpeech<T>(
  sidecar: JsonLineSidecar,
  method: string,
  params: unknown,
  options?: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void },
): AsyncResult<T> {
  const result = await sidecar.request(method, jsonParams(params), {
    ...(options?.signal ? { signal: options.signal } : {}),
    onNotification(message) {
      if (message.type === 'progress' && typeof message.fraction === 'number') {
        options?.onProgress?.(message.fraction);
      }
    },
  });
  if (result.ok) return ok(result.value as T);
  return err(speechError(result.error));
}

function jsonParams(params: unknown): JsonValue {
  if (params === undefined || params === null) return {};
  return JSON.parse(JSON.stringify(params)) as JsonValue;
}

function speechError(error: TaalcutError): TaalcutError {
  if (CANCELLED.has(error.code)) return CancelledError();
  const helper = error.params?.helperCode;
  if (typeof helper !== 'string' || helper.length === 0 || helper === error.code) return error;
  return {
    code: helper,
    messageKey: error.messageKey,
    retryable: error.retryable,
    ...(error.params ? { params: error.params } : {}),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.fix === undefined ? {} : { fix: error.fix }),
  };
}

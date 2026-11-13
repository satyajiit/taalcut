// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetId, AsyncResult } from '@taalcut/core';

/** Acquisition stays outside the offline authoring shell and never inherits the person's browser profile. */
export interface CreationCapture {
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly assets: readonly {
    readonly assetId: AssetId;
    readonly mimeType: string;
    readonly label: string;
  }[];
  readonly evidence?: readonly string[];
}

export interface CreationDirectorySnapshot {
  readonly id: string;
  readonly digest: string;
  readonly files: readonly { readonly path: string; readonly text: string }[];
}

export interface CreationProjectExecution {
  readonly snapshotId: string;
  readonly packageManager: 'npm' | 'pnpm';
  readonly script: string;
  readonly buildScript: string | null;
  readonly install: boolean;
  readonly timeoutMs: number;
}

export interface CreationSourceHost {
  readAsset(assetId: AssetId, signal: AbortSignal): AsyncResult<CreationCapture>;
  /** The host resolves accessId from an explicit directory picker grant, never from an agent-supplied path. */
  snapshotDirectory(accessId: string, signal: AbortSignal): AsyncResult<CreationDirectorySnapshot>;
  captureUrl(url: string, signal: AbortSignal): AsyncResult<CreationCapture>;
  /** Uses a disposable snapshot and managed dependencies, with no write permission to the original directory. */
  runProject(request: CreationProjectExecution, signal: AbortSignal): AsyncResult<CreationCapture>;
  /** Enforces redirect/DNS checks, a byte limit, and HTTPS. Returns no cookies or credentials. */
  request(
    url: string,
    options: { readonly kind: 'json' | 'svg'; readonly signal: AbortSignal; readonly maxBytes: number },
  ): AsyncResult<{ readonly body: string; readonly finalUrl: string }>;
}

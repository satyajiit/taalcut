// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** HFW1: the fold's shared types (a leaf, so the compile and the fold import each other's shapes, not code). */
import type { FrameSpan } from '../../plan/types';
import type { PreparedComposition } from '../gate/prepare';

/** A composition placed on the timeline: the item it draws, its frames, and its variables' values. */
export interface CompositionPlacement {
  readonly itemId: string;
  readonly span: FrameSpan;
  readonly composition: PreparedComposition;
  readonly values: Readonly<Record<string, string | number | boolean>>;
  /** Native programs preserve their source clock instead of stretching an exit label. */
  readonly sourceStart?: number;
  /** The assets it loads, by their path in the composition (`assets/<sha256>`): where they sit in the bundle. */
  readonly assets?: Readonly<Record<string, AssetLink>>;
}

/** An asset linked into the bundle: its bundle path, its file, and its key (its sha256). */
export interface AssetLink {
  readonly bundlePath: string;
  readonly source: string;
  readonly key: string;
}

/** An asset's file and the image type its bytes are. */
export interface WorkspaceAsset {
  readonly file: string;
  readonly ext: 'png' | 'jpg' | 'webp' | 'gif' | 'svg';
}

/** Reads a project's workspace blobs (reader.ts over `<userData>/workspaces/<projectId>/blobs`). */
export interface WorkspaceReader {
  /** A text file's content, undefined when the workspace does not hold it. */
  text(sha256: string): string | undefined;
  asset(sha256: string): WorkspaceAsset | undefined;
}

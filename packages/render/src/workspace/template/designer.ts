// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): what the template's reading asks of the Designer, and what comes back. A job is one composition
 * brief (brief.ts) in the Designer's words, the reel's frames of its overlays, and, on a later round, why the last
 * one didn't do (the vision judge's differences, or a made video's failed frame check) with the frames that show
 * it. The answer is a composition that passed the gate and each overlay's values for its variables, or the reason
 * there is none. The Designer is dsn's `render.designer` skill; the port lets the reading and the make run on a
 * stand-in until it is in, and in tests. There is no other design behind it.
 */
import type {
  AsyncResult,
  GraphicComposition,
  GraphicParamValues,
  ProjectId,
  TextOverlay,
  WorkspaceFrame,
} from '@taalcut/core';
import type { CompositionBrief } from './brief';

/** A picture for a vision model: base64 bytes. */
export interface DesignPicture {
  readonly data: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
}

/** A reel frame of one overlay at one of its brief's moments. */
export interface ReelFrame {
  readonly overlayId: TextOverlay['id'];
  readonly moment: 'before' | 'entrance' | 'hold' | 'exit';
  /** Seconds into the reel. */
  readonly seconds: number;
  readonly picture: DesignPicture;
}

/** Why the last design didn't do, with the frames that show it. */
export interface DesignFeedback {
  readonly previous: GraphicComposition;
  /** In plain words, for the Designer: what differs from the reel, or which check failed and how. */
  readonly reason: string;
  readonly frames: readonly { readonly label: string; readonly picture: DesignPicture }[];
}

export interface DesignJob {
  /** The project whose workspace it designs in. */
  readonly projectId: ProjectId;
  readonly brief: CompositionBrief;
  /** The brief in the Designer's words (brief-text.ts). */
  readonly markdown: string;
  readonly reel: readonly ReelFrame[];
  readonly feedback: DesignFeedback | null;
}

export interface DesignedComposition {
  /** It passed the gate. */
  readonly composition: GraphicComposition;
  /** Each overlay's values for its variables (its words, where it sits when the overlays differ), by overlay id. */
  readonly params: Readonly<Record<string, GraphicParamValues>>;
  /** A conversation bubble's words' type as drawn (its size and padding), for the thread's next bubble to share. */
  readonly type?: DrawnType;
}

/** Words' type as a still measured it: font size and padding, px on the canvas (core's `WorkspaceFrame.type`). */
export type DrawnType = NonNullable<WorkspaceFrame['type']>;

export type DesignerAnswer =
  | { readonly designed: DesignedComposition }
  /** None passed: the reason in plain words. */
  | { readonly reason: string };

/** The Designer, as the reading and the make call it. Never throws. */
export type DesignOverlay = (job: DesignJob, signal?: AbortSignal) => AsyncResult<DesignerAnswer>;

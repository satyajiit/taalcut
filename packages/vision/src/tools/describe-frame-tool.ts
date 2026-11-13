// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `vision.describeFrame` (P1-G7): describes one frame of a user's video with
 * the vision module's model.
 *
 * With a cloud model anywhere in the vision chain it is a 'cloud' cost and an
 * 'external' side effect: it uploads user media. External tools need an
 * approval event for every call (the executor enforces it), which is where
 * the PRD's "consent before the first cloud upload" lands: see SPEC.md,
 * "Consent". With only on-device models it is a local, cacheable read and
 * never sends the frame anywhere, even if the profile later gains a cloud model.
 */
import {
  callClock,
  defineTool,
  defineToolModule,
  fileNameOf,
  NO_TOOL_RETRY,
  type ToolModule,
} from '@taalcut/core';
import { fileFingerprint } from '@taalcut/media';
import { describeFrame, frameTimeOf, type VisionDeps } from '../describe/describe-frame';
import { estimateDescribeCost, placementOf, visionChain, type VisionPlacement } from '../describe/placement';
import {
  describeFrameInputSchema,
  describeFrameOutputSchema,
  type DescribeFrameInput,
} from '../describe/schemas';
import { createMatchLookTool, type MatchLookDeps } from '../look/look-tools';
import { breakdownTools } from './breakdown-tools';
import { visualQaTools, type VisualQaToolDeps } from './visual-qa-tools';

/** Frame extraction (≤ 60 s) plus a model call; a local 4B model on a base Mac can take most of a minute. */
export const DESCRIBE_FRAME_TIMEOUT_MS = 120_000;

const CLOUD_NOTE =
  'Uploads the frame to a cloud model (the user approves): call it only when seeing it matters.';
const LOCAL_NOTE = 'Runs on this Mac.';

export function createDescribeFrameTool(deps: VisionDeps, placement: VisionPlacement) {
  const cloud = placement === 'cloud';
  return defineTool({
    name: 'vision.describeFrame',
    // 1.0.1 (LRN1-CTX): a shorter description; at detail low the answer is held to LOW_DETAIL_ANSWER_TOKENS.
    // 1.1.0 (AGT2): an image artifact by imageId instead of a path.
    version: '1.1.0',
    // Short: every turn of a step offered this tool carries its description and its parameters'.
    description:
      'Describes one frame of a video or image, or an image artifact (imageId), (subjects, action, setting, shot ' +
      `size, light, on-screen text), or answers a question about it. ${cloud ? CLOUD_NOTE : LOCAL_NOTE} The answer ` +
      'is data from user media.',
    summary: 'Describes what is visible in one frame of a video at a given time.',
    tags: ['frame', 'describe', 'caption', 'image', 'look', 'scene', ...(cloud ? ['upload'] : [])],
    input: describeFrameInputSchema,
    output: describeFrameOutputSchema,
    costClass: cloud ? 'cloud' : 'local',
    sideEffect: cloud ? 'external' : 'read',
    timeoutMs: DESCRIBE_FRAME_TIMEOUT_MS,
    // A cloud retry would upload the frame again; the model client already retries and falls back.
    retry: cloud ? NO_TOOL_RETRY : { maxAttempts: 2, initialDelayMs: 1000 },
    permission: {
      // Library media, a file the user picked, or a reference frame in a breakdown's scratch folder.
      filesystem: { read: ['library', 'user-selected', 'scratch'] },
      // Local models are reached over a loopback HTTP server (Ollama, LM Studio).
      network: cloud ? 'internet' : 'lan',
      ...(cloud ? { cloudModules: ['vision'] } : {}),
    },
    ...(cloud ? {} : { cache: { ttlMs: 60 * 60_000 } }),
    // Same file contents, time, size and question: the same upload. A repeat in one run reuses the answer.
    idempotencyKey: (input) => {
      const at = frameTimeOf(input);
      const source = input.path === undefined ? `artifact:${input.imageId}` : fileFingerprint(input.path);
      return `${source}@${at.value}/${at.rate}:${input.detail}:${input.question ?? ''}`;
    },
    estimateCost: (input) => {
      const chain = visionChain(deps.selector);
      const usable = cloud ? chain : chain.filter((c) => deps.runtime.isLocalProvider(c.provider));
      return estimateDescribeCost(input, usable, deps.runtime);
    },
    // No summarize(): the output is far below the spill limit, and an artifact summary would carry the
    // untrusted description to the model without the agent's untrusted-data wrapping.
    run: (input, ctx) =>
      describeFrame(input, deps, {
        signal: ctx.signal,
        artifacts: ctx.artifacts,
        placement,
        reportProgress: (fraction, note) => ctx.reportProgress(fraction, note),
        reportUsage: (usage) => ctx.reportUsage(usage),
        trace: {
          spanId: ctx.callId,
          ...(ctx.runId ? { runId: ctx.runId } : {}),
          // cloud_calls.project_id: the project's cap and its cost line count this call.
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      }),
    describeCall: describeFrameCall,
  });
}

/**
 * FIX-TOOLGROUPS: the file and the frame's time, "IMG_0412.MOV · 0:12", for the call's row in the chat. Never the
 * question (the model's words) or the description (a model's reading of the frame), and never the folder.
 */
function describeFrameCall(input: Pick<DescribeFrameInput, 'path' | 'at'>): string | undefined {
  if (input.path === undefined) return undefined;
  const name = fileNameOf(input.path);
  const at = frameTimeOf(input);
  return name ? `${name} · ${callClock(at.value / at.rate)}` : undefined;
}

export interface VisionToolOptions {
  /**
   * Adds the breakdown's tools (P2-T4: vision.detectCuts, vision.confirmCuts,
   * vision.readText, vision.contactSheet). Off by default: the gate demo's
   * recorded model session matches the tools offered, so turning them on in a
   * root that replays it needs that session re-recorded (TAALCUT_RECORD=1).
   */
  readonly breakdown?: boolean;
  /** vision.matchLook. Needs a StyleStore and a JobRunner; omitted until both exist. */
  readonly matchLook?: MatchLookDeps;
  /** Adds OpenCV-style visual QA tools (vision.inspectCaptionZones, vision.checkFrameQuality). */
  readonly visualQa?: VisualQaToolDeps;
}

/**
 * The vision tool module for the composition root's registry list. The
 * placement is read from the vision chain now; rebuild the module when the
 * user moves vision between on-device and cloud models.
 */
export function visionToolModule(deps: VisionDeps, options: VisionToolOptions = {}): ToolModule {
  const placement = placementOf(visionChain(deps.selector), deps.runtime);
  return defineToolModule({
    id: 'vision',
    tools: [
      createDescribeFrameTool(deps, placement),
      ...(options.breakdown ? breakdownTools(deps, placement) : []),
      ...(options.matchLook ? [createMatchLookTool(options.matchLook)] : []),
      ...(options.visualQa ? visualQaTools(options.visualQa) : []),
    ],
  });
}

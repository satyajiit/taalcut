// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A decode route: how one hardware (or the software) decoder turns a file's
 * video into upright frames for a multi-branch graph (frame sets and the
 * analysis pass). The graph decodes once, runs `shared` on every frame,
 * splits, and runs `branch` per output size. Each decoder is an
 * implementation chosen from the plan's hw-video row or the hardware profile (`decodeRouteFor`), never
 * an `if` inside another one: VideoToolbox on a Mac, NVDEC (CUDA) on Linux or a Windows NVIDIA profile,
 * D3D11VA on other Windows profiles, the software decoder when the plan says the
 * hardware can't take the file.
 */
import type { MediaBackend } from '../hw-video/types';
import { downloadsDeep, type GraphTarget } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';

/** A hw-video row's id, or the software decoder. */
export type DecodeRouteId = MediaBackend;

export interface BranchPicture {
  /** The size this branch asks for, in upright orientation; undefined keeps the source size. */
  readonly target?: GraphTarget;
  /** Exactly `target` (a model's grid), not a box the picture fits in. */
  readonly exact?: boolean;
  /**
   * An HDR source: `shared` already downloaded and tone-mapped every frame, so the branch scales on the
   * CPU. libplacebo's tone-map measures peaks across frames, so it must see every frame once, in order,
   * as one chain would: tone-mapping per branch after a `select` would change its output.
   */
  readonly toned: boolean;
}

export interface DecodeRoute {
  readonly id: DecodeRouteId;
  /**
   * Whether the decoder honours `-skip_frame nokey` (keyframe-only decode, IX2-T1): FFmpeg's own H.264
   * and HEVC decoders skip non-key pictures while parsing slices, before any hwaccel sees them, so every
   * route here does (VideoToolbox measured on this Mac). NVIDIA's `*_cuvid` wrapper decoders don't
   * (libavcodec/cuviddec.c has no skip_frame handling): a route built on them must say false.
   */
  readonly honoursSkipFrame: boolean;
  /**
   * Whether an SDR branch scales on the device and downloads at its size, so its frames reach the CPU small and
   * only convert there (IX2-F15: the graph's scales then run on one thread, `ONE_THREAD_SCALES`). A route whose
   * branches scale on the CPU keeps the scales' threads: a conversion that scales repeats.
   */
  readonly scalesOnDevice: boolean;
  /**
   * Whether a run on this route may hold a hardware video session (a decoder session on the device), so that
   * stopping it follows the end policy's no-kill path (process/end-policy.ts, IX3-K2). Every device route does;
   * the software route doesn't.
   */
  readonly holdsVideoSession: boolean;
  /** Input options before `-i`. */
  inputArgs(plan: NormalisationPlan): string[];
  /**
   * On every decoded frame before the split: the display matrix dropped, upright where the device can
   * turn it, and for an HDR source (`toneMap` not empty) downloaded and tone-mapped.
   */
  shared(plan: NormalisationPlan, toneMap: readonly string[]): string[];
  /** One branch: scaled (on the device where it can), downloaded, toned and turned upright. */
  branch(plan: NormalisationPlan, picture: BranchPicture): string[];
}

/** The format a single download before the CPU names (D3D11VA's): see `downloadsDeep`. */
export function downloadFormat(plan: NormalisationPlan, hdr: boolean, surface: string): string {
  return downloadsDeep(plan, hdr) ? 'p010le' : surface;
}

/** The size before a 90° or 270° turn: a device that scales before the CPU turns the picture needs it sideways. */
export function beforeTurn(plan: NormalisationPlan, target: GraphTarget): GraphTarget {
  return plan.rotation === 90 || plan.rotation === 270
    ? { width: target.height, height: target.width }
    : target;
}

/** The display matrix travels on hardware frames; the turn is applied here, so it must not be applied twice. */
export const DROP_DISPLAY_MATRIX = 'sidedata=mode=delete:type=DISPLAYMATRIX';

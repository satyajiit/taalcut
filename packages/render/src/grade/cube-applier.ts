// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The GPU route of a grade (SPEC P3.7): a port that applies a `.cube` to a video file on the GPU, and its
 * implementation over the mac helper's `grade` service (`video.applyCube`: Core Image's
 * `CIColorCubeWithColorSpace` in a Metal-backed context, VideoToolbox encode; native/mac-helper SPEC, "Service
 * `grade`"). Windows or Linux would be another implementation of the same port. The helper's JSON is
 * validated here; its error codes become render's.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import type { JsonLineSidecar } from '@taalcut/media';
import { z } from 'zod';
import { CubeInvalid, GradeFailed } from '../errors-phase3';

export interface CubeApplyRequest {
  /** A conformed segment (video only). */
  readonly input: string;
  readonly output: string;
  readonly cube: string;
  /** The encoding the cube was fitted in: BT.709 R′G′B′ (the only one v1 writes). */
  readonly colourSpace: 'bt709';
}

export type CubeApplyOutcome =
  | { readonly kind: 'applied'; readonly frames: number; readonly ms: number }
  /** No GPU to run it on (the helper found no Metal device): the CPU route takes over, logged. */
  | { readonly kind: 'noAccelerator'; readonly detail: string };

export interface CubeApplyOptions {
  readonly signal?: AbortSignal;
  /** The helper's pid, just before the request goes to it: the caller's lease records it first (IX3-F7). */
  readonly onSend?: (pid: number) => void;
  /**
   * Called once when the applier has let go of its sessions: the helper's answer or its exit, or at once when no
   * request went out. A cancel or a timeout may return first; the caller's sessions stay held until then, and the
   * CPU route waits for it (IX3-F5, H5).
   */
  readonly onLetGo?: () => void;
}

export interface CubeApplier {
  /** Cube edge sizes this applier takes; another size goes the CPU route. */
  readonly sizes: readonly number[];
  apply(request: CubeApplyRequest, options?: CubeApplyOptions): AsyncResult<CubeApplyOutcome>;
}

/** What the helper client needs: media's JsonLineSidecar fits. */
export type HelperRequester = Pick<JsonLineSidecar, 'request'>;

export const APPLY_CUBE_METHOD = 'video.applyCube';
/** The helper reads 17³ cubes only (its `grade.cube_invalid` for any other size). */
export const HELPER_CUBE_SIZES = [17] as const;
/** A ten-minute clip at 60 fps through Core Image stays well inside this. */
const APPLY_TIMEOUT_MS = 15 * 60_000;

const appliedSchema = z.object({
  output: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  frames: z.int().nonnegative(),
  compute: z.literal('gpu'),
  ms: z.number().nonnegative(),
});

function helperCodeOf(params: unknown): string | null {
  const parsed = z.object({ helperCode: z.string() }).safeParse(params);
  return parsed.success ? parsed.data.helperCode : null;
}

export function createHelperCubeApplier(helper: HelperRequester): CubeApplier {
  return {
    sizes: HELPER_CUBE_SIZES,
    async apply(request, { signal, onSend, onLetGo } = {}) {
      const sent = await helper.request(
        APPLY_CUBE_METHOD,
        {
          input: request.input,
          output: request.output,
          cube: request.cube,
          colourSpace: request.colourSpace,
        },
        {
          ...(signal ? { signal } : {}),
          timeoutMs: APPLY_TIMEOUT_MS,
          // A cancel or a timeout waits for the helper's answer (within media's grace), as decode does (IX3-F5, H5).
          settleOnReply: true,
          ...(onSend ? { onSend } : {}),
          ...(onLetGo ? { onLetGo } : {}),
        },
      );
      if (!sent.ok) {
        const error = sent.error;
        if (error.code === 'media.cancelled') return err(CancelledError());
        const code = helperCodeOf(error.params);
        const detail = `${code ?? error.code}: ${error.detail ?? ''}`.slice(0, 500);
        if (code === 'grade.no_metal') return ok({ kind: 'noAccelerator', detail });
        if (code === 'grade.cube_invalid') return err(CubeInvalid({ reason: 'helper' }, { detail }));
        // grade.failed is retryable on the helper's side; grade.unreadable, a path outside the allowed roots
        // or a helper crash are not, and the caller takes the CPU route either way.
        return err(GradeFailed(undefined, { detail }));
      }
      const parsed = appliedSchema.safeParse(sent.value);
      if (!parsed.success)
        return err(
          GradeFailed(undefined, {
            detail: `Unexpected helper result: ${parsed.error.message}`.slice(0, 500),
          }),
        );
      return ok({ kind: 'applied', frames: parsed.data.frames, ms: parsed.data.ms });
    },
  };
}

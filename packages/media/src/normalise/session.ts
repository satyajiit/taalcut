// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a decode job settles before it runs: the plan on this machine's hardware rows, the tone-map choice, and
 * the software decode route used when the hardware decoder fails.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { planDecode, type DecodePlan, type ToneMapChoice } from '../backends';
import type { MediaContext } from '../ffmpeg';
import { machineVideoBackends } from '../hw-video/machine';
import type { MachineVideoBackends } from '../hw-video/types';
import { selectToneMap } from '../tonemap';
import { applyRouteWarnings, type NormalisationPlan } from './types';

/**
 * The plan's decode on this machine. A plan is made from the probe alone (on the platform's default rows) and
 * may be stored; when the machine lacks its row (no NVIDIA GPU, `CUDA_VISIBLE_DEVICES=-1`) or has one the plan
 * didn't know of, the decode is planned again from the plan's source on the machine's rows. A plan that went to
 * the CPU for its file (codec, format, request) keeps that.
 */
export function onMachine(plan: NormalisationPlan, machine: MachineVideoBackends): NormalisationPlan {
  if (plan.kind === 'audio') return plan;
  const decode = plan.decode;
  if (decode.backend === 'software' && decode.fallbackReason.code !== 'no_hardware_backend') return plan;
  if (decode.backend !== 'software' && machine.backends.includes(decode.backend)) return plan;
  const source = { codec: plan.source.codec, pixelFormat: plan.source.pixelFormat };
  const again = planDecode(source, { machine, still: plan.kind === 'image' });
  // Still no row: keep the plan's own reason unless the machine says why (a trial failed, or hardware is off).
  if (again.backend === 'software' && decode.backend === 'software' && !machine.missing && !machine.disabled)
    return plan;
  return { ...plan, decode: again };
}

export async function resolveTone(
  source: NormalisationPlan,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<{ readonly plan: NormalisationPlan; readonly tone: ToneMapChoice }> {
  let plan = source;
  if (ctx.videoBackends) {
    const machine = await machineVideoBackends(ctx, signal);
    if (!machine.ok) return machine;
    plan = onMachine(source, machine.value);
  }
  if (plan.toneMap !== 'required') return ok({ plan, tone: { method: 'none', backend: 'software' } });
  const options = signal ? { signal } : {};
  const tone = ctx.toneMaps ? await ctx.toneMaps.get(ctx, options) : await selectToneMap(ctx, options);
  if (!tone.ok) return tone;
  return ok({ plan: applyRouteWarnings(plan, tone.value), tone: tone.value });
}

export function failedRoute(detail: string): DecodePlan {
  return { backend: 'software', fallbackReason: { code: 'hardware_failed', detail: detail.slice(0, 180) } };
}

export function gist(detail: string | undefined): string {
  return (detail ?? 'ffmpeg failed').replace(/\s+/g, ' ').slice(0, 180);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Device-lab check for P2-L4. Prints every container and stream tag, conforms
 * the first two seconds, and scores a sibling `<name>.golden.png` when one
 * is present. A bad file is reported and does not fail the run.
 *
 *   pnpm --filter @taalcut/media run lab -- <folder>
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { RationalTime } from '@taalcut/core';
import { createBinaryResolver } from './binaries/resolver';
import { compareFrames } from './primitives/compare';
import { probeMedia } from './probe/probe';
import { conform } from './normalise/conform';
import { planNormalisation } from './normalise/plan';
import type { ProbeResult } from './probe/types';

const MEDIA = /\.(mov|mp4|m4v|m4a|heic|heif|jpg|jpeg|png|wav|aac|mkv|webm)$/i;

function tagsOf(probe: ProbeResult) {
  return {
    file: basename(probe.path),
    container: probe.container,
    tags: probe.tags,
    phone: probe.phone ?? null,
    creationTime: probe.creationTime ?? null,
    streams: probe.streams.map((stream) => ({
      index: stream.index,
      kind: stream.kind,
      codec: stream.codec,
      tags: stream.tags,
    })),
  };
}

async function one(path: string, ctx: Parameters<typeof probeMedia>[1]): Promise<void> {
  const probed = await probeMedia(path, ctx);
  if (!probed.ok) {
    process.stdout.write(`${JSON.stringify({ file: basename(path), error: probed.error.code, detail: probed.error.detail })}\n`);
    return;
  }
  const size = await stat(path).then((info) => info.size).catch(() => 0);
  const planned = planNormalisation(probed.value, { sizeBytes: size });
  if (!planned.ok) {
    process.stdout.write(
      `${JSON.stringify({ ...tagsOf(probed.value), error: planned.error.code, detail: planned.error.detail })}\n`,
    );
    return;
  }
  const plan = planned.value;
  const report: Record<string, unknown> = {
    ...tagsOf(probed.value),
    plan: { kind: plan.kind, hdr: plan.hdr, rotation: plan.rotation, frames: plan.frames, warnings: plan.warnings },
  };
  if (plan.kind === 'video') {
    const frames = Math.max(1, Math.min(plan.frames, Math.round(2 * (plan.frameRate.output.num / plan.frameRate.output.den))));
    const out = `${path}.conform.mp4`;
    const made = await conform(path, plan, ctx, {
      out,
      codec: 'h264',
      range: { start: RationalTime.of(0, plan.frameRate.output), duration: RationalTime.of(frames, plan.frameRate.output) },
    });
    report.conform = made.ok ? { driftMs: made.value.driftMs, frames: made.value.frames } : { error: made.error.code, detail: made.error.detail };
    const golden = join(dirname(path), `${basename(path, extname(path))}.golden.png`);
    if (made.ok && (await stat(golden).catch(() => undefined))) {
      const scored = await compareFrames(golden, out, ctx, { metric: 'ssim' });
      report.ssim = scored.ok ? scored.value.mean : { error: scored.error.code };
    }
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const folder = process.argv[2];
if (!folder) {
  console.error('usage: pnpm --filter @taalcut/media run lab -- <folder>');
  process.exit(2);
}
const info = await stat(folder).catch(() => undefined);
if (!info?.isDirectory()) {
  console.error(`${folder} is not a directory`);
  process.exit(1);
}
const binaries = await createBinaryResolver({ development: true }).resolve();
if (!binaries.ok) {
  console.error(`${binaries.error.code}: ${binaries.error.detail ?? ''}`);
  process.exit(1);
}
const names = (await readdir(folder)).filter((name) => MEDIA.test(name)).sort();
for (const name of names) await one(join(folder, name), { binaries: binaries.value });

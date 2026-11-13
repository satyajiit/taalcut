// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl's stand-in Designer, for tests only: it answers each role with a fixture composition written by hand
 * under ./fixtures (a made-up incoming bubble and a reply with ticks), gated by render's own gate, so the reading
 * and the make run end to end before the real Designer (dsn's `render.designer`) is in. Shipped code has no design.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  compositionHash,
  newId,
  ok,
  type GraphicComposition,
  type GraphicCompositionId,
} from '@taalcut/core';
import { gateComposition } from '../../../src/workspace/gate/workspace-gate';
import type { DesignJob, DesignOverlay } from '../../../src/workspace/template/designer';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

/** A fixture as a kept composition record: its one file by content, gated. */
export async function fixtureComposition(
  name: string,
  id: GraphicCompositionId = newId<'GraphicComposition'>(),
): Promise<{ composition: GraphicComposition; text: string }> {
  const text = await readFile(join(FIXTURES, name), 'utf8');
  const file = {
    path: 'index.html',
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
  const gated = await gateComposition({ entry: 'index.html', files: [{ ...file, text }], now: 1 });
  if (!gated.gate.passed) throw new Error(`${name}: ${JSON.stringify(gated.findings, null, 1)}`);
  const composition: GraphicComposition = {
    id,
    version: 1,
    hash: await compositionHash([file]),
    name: name.replace(/\.html$/, '').replace(/-/g, ' '),
    entry: 'index.html',
    files: [file],
    variables: [...gated.variables],
    durationSeconds: gated.durationSeconds ?? 3,
    provenance: {
      model: { id: 'stand-in/designer', onDevice: false },
      overlays: [],
      brief: null,
      createdAt: 1,
    },
    gate: gated.gate,
  };
  return { composition, text };
}

const FIXTURE_FOR: Partial<Record<DesignJob['brief']['role'], string>> = {
  incomingMessage: 'incoming-bubble.html',
  outgoingMessage: 'reply-bubble.html',
};

/** The stand-in: a fixture per message role, no design for any other; `jobs` keeps what it was asked. */
export function standInDesigner(): DesignOverlay & { readonly jobs: DesignJob[] } {
  const jobs: DesignJob[] = [];
  const design: DesignOverlay = async (job) => {
    jobs.push(job);
    const name = FIXTURE_FOR[job.brief.role];
    if (!name) return ok({ reason: `The stand-in has no design for a ${job.brief.role}` });
    const { composition } = await fixtureComposition(name);
    const params = Object.fromEntries(job.brief.overlays.map((overlay) => [overlay.overlayId, {}]));
    return ok({ designed: { composition, params } });
  };
  return Object.assign(design, { jobs });
}

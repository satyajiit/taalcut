// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G1: `audio.compare`'s `{ templateId }` in the agent process (agent-listen-qa.ts). The reel is the file the
 * template media store keeps (REF1), asked at each call; a template without one, with a silent one, or a process
 * without the store gives none (the tool then says the template keeps no reel with sound).
 */
import { describe, expect, it } from 'vitest';
import {
  createContainer,
  err,
  newId,
  NotFoundError,
  ok,
  TemplateMediaStoreToken,
  type TemplateId,
  type TemplateMediaStore,
} from '@taalcut/core';
import { templateReel } from '../src/utility/roots/agent-listen-qa';

const withReel = newId<'Template'>();
const silent = newId<'Template'>();
const failing = newId<'Template'>();
const gone = NotFoundError({ entity: 'template', id: failing });

const media: Pick<TemplateMediaStore, 'get'> = {
  get: async (templateId: TemplateId) => {
    if (templateId === failing) return err(gone);
    if (templateId !== withReel && templateId !== silent) return ok(null);
    return ok({
      media: {
        file: 'reference.mp4',
        bytes: 10,
        durationMs: 12_000,
        sha256: 'a'.repeat(64),
        hasAudio: templateId === withReel,
        source: 'anonymous',
        keptAt: 1,
      },
      path: `/templates/media/${templateId}/reference.mp4`,
    });
  },
};

describe('the template’s reel for audio.compare (EAR1-G1)', () => {
  it('is the kept reel’s file when it has sound, else none', async () => {
    const container = createContainer();
    const { templateReel: reel } = templateReel(container);
    // Registered after the tools were built: asked at each call.
    expect(await reel!(withReel)).toEqual(ok(null));
    container.value(TemplateMediaStoreToken, media as TemplateMediaStore);
    expect(await reel!(withReel)).toEqual(ok(`/templates/media/${withReel}/reference.mp4`));
    expect(await reel!(silent)).toEqual(ok(null));
    expect(await reel!(newId<'Template'>())).toEqual(ok(null));
    expect(await reel!(failing)).toEqual(err(gone));
    await container.dispose();
  });
});

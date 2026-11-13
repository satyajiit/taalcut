// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  authoredProgramSchema,
  authoredEditSchema,
  creationCommandPayloads,
  CREATION_COMMANDS,
  creationProjectSchema,
  creationSourceInputSchema,
  newId,
} from '@taalcut/core';
import { at, json } from './helpers/documents';

const projectId = newId<'Project'>();
const brief = {
  category: 'product-launch',
  title: 'Launch',
  prompt: 'Show the product',
  audience: 'Creators',
  callToAction: 'Try it',
  formats: ['16:9'],
  duration: at(1350),
  voice: { mode: 'none', voiceId: null, assetId: null, language: 'en' },
};

describe('creation contracts', () => {
  it('creates without a template and requires revision-bound approval', () => {
    expect(creationCommandPayloads[CREATION_COMMANDS.create].safeParse(json({ brief })).success).toBe(true);
    expect(
      creationCommandPayloads[CREATION_COMMANDS.approve].safeParse({ projectId, revision: 3 }).success,
    ).toBe(false);
    expect(
      creationCommandPayloads[CREATION_COMMANDS.approve].safeParse({
        projectId,
        revision: 3,
        draftRevision: 2,
      }).success,
    ).toBe(true);
  });
  it('keeps source directories behind grants', () => {
    const source = { id: newId<'CreationSource'>(), kind: 'directory', label: 'Product' };
    expect(creationSourceInputSchema.safeParse(source).success).toBe(false);
    expect(
      creationSourceInputSchema.parse({ ...source, accessId: 'grant', path: '/private' }),
    ).not.toHaveProperty('path');
  });
  it('round-trips rational timing and strips developer errors from the window record', () => {
    const record = creationProjectSchema.parse(
      json({
        projectId,
        revision: 1,
        brief,
        sources: [],
        draft: null,
        approvedDraftRevision: null,
        status: 'draft',
        tasks: [],
        timelineId: null,
        budget: { capMicros: null, spentMicros: 0, reservedMicros: 0 },
        error: {
          code: 'creation.failed',
          messageKey: 'errors.creation.failed',
          retryable: true,
          detail: '/private',
        },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    expect(record.brief.duration.value).toBe(1350);
    expect(record.error).not.toHaveProperty('detail');
  });
  it('validates larger immutable program files separately from graphics and rejects duplicate paths', () => {
    const file = { path: 'index.html', sha256: 'a'.repeat(64), bytes: 100_000 };
    const program = {
      id: newId<'AuthoredProgram'>(),
      hash: 'b'.repeat(64),
      version: 1,
      entry: 'index.html',
      files: [file],
      canvas: { width: 1920, height: 1080, rate: at(0).rate },
      duration: at(1350),
      chapters: [],
      assetIds: [],
    };
    expect(authoredProgramSchema.safeParse(json(program)).success).toBe(true);
    expect(authoredProgramSchema.safeParse(json({ ...program, files: [file, file] })).success).toBe(false);
    expect(authoredProgramSchema.safeParse(json({ ...program, entry: '../index.html' })).success).toBe(false);
  });
  it('takes explicit elements for edits and bounded cursor paths', () => {
    expect(
      authoredEditSchema.safeParse({ kind: 'text', target: 'hf-title', text: 'New title' }).success,
    ).toBe(true);
    expect(authoredEditSchema.safeParse({ kind: 'text', text: 'New title' }).success).toBe(false);
    expect(
      authoredEditSchema.safeParse({ kind: 'path', animationId: 'tween-1', autoRotate: false, segments: [] })
        .success,
    ).toBe(false);
  });
});

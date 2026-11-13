// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { RationalTime, unwrap } from '@taalcut/core';
import { editAuthoredProgram, inspectAuthoredProgram } from '../../src/authored/editor';
import { prepareAuthoredProgram } from '../../src/authored/prepare';
import { prepareComposition } from '../../src/workspace/gate/prepare';
import { authoredFixture, authoredSource } from './support';

describe('authored source editor', () => {
  it('uses a separate long-form profile while retaining the graphic gate limit', () => {
    expect(prepareComposition(authoredSource).ok).toBe(false);
    expect(prepareAuthoredProgram(authoredSource)).toMatchObject({ ok: true });
    const inspection = unwrap(inspectAuthoredProgram(authoredSource, authoredFixture()));
    expect(inspection.elements.find((element) => element.id === 'hf-title')?.text).toBe('Launch');
    expect(inspection.animations[0]?.duration.value).toBe(1200);
  });

  it('round trips manual words, placement and ordering through the same renderable source', async () => {
    const program = authoredFixture();
    const edited = unwrap(
      await editAuthoredProgram(authoredSource, program, [
        { kind: 'text', target: 'hf-title', text: 'Ready & steady' },
        { kind: 'style', target: 'hf-title', styles: { fontSize: '120px', color: '#00ff88' } },
        { kind: 'order', target: 'hf-title', zIndex: 5 },
      ]),
    );
    expect(edited.source).toContain('Ready &amp; steady');
    const read = unwrap(inspectAuthoredProgram(edited.source, program));
    expect(read.elements.find((element) => element.id === 'hf-title')?.styles).toMatchObject({
      fontSize: '120px',
      zIndex: '5',
    });
    expect(prepareAuthoredProgram(edited.source).ok).toBe(true);
  });

  it('persists tween timing and editable keyframes in source', async () => {
    const program = authoredFixture();
    const original = unwrap(inspectAuthoredProgram(authoredSource, program));
    const animation = original.animations[0]!;
    const edited = unwrap(
      await editAuthoredProgram(original.source, program, [
        {
          kind: 'tween',
          animationId: animation.id,
          target: 'hf-title',
          at: RationalTime.of(60, program.canvas.rate),
          duration: RationalTime.of(600, program.canvas.rate),
          ease: 'power2.inOut',
          from: { x: 0 },
          to: { x: 800 },
        },
      ]),
    );
    expect(edited.animations[0]).toMatchObject({
      at: { value: 60 },
      duration: { value: 600 },
      to: { x: 800 },
    });
    const keyedResult = await editAuthoredProgram(edited.source, program, [
      { kind: 'keyframe', animationId: edited.animations[0]!.id, index: 2, position: 50, values: { x: 200 } },
    ]);
    expect(keyedResult, JSON.stringify(keyedResult)).toMatchObject({ ok: true });
    const keyed = unwrap(keyedResult);
    expect(keyed.animations[0]?.keyframes).toEqual(
      expect.arrayContaining([expect.objectContaining({ position: 50, values: { x: 200 } })]),
    );
  });

  it('keeps cursor paths editable and rejects an unsafe edit atomically', async () => {
    const program = authoredFixture();
    const before = unwrap(inspectAuthoredProgram(authoredSource, program));
    const animation = before.animations.find((item) => item.targets.includes('hf-cursor'))!;
    const curved = await editAuthoredProgram(before.source, program, [
      {
        kind: 'path',
        animationId: animation.id,
        autoRotate: false,
        segments: [{ cp1: { x: 100, y: 0 }, cp2: { x: 300, y: 300 } }],
      },
    ]);
    expect(curved, JSON.stringify(curved)).toMatchObject({ ok: true });
    if (curved.ok)
      expect(curved.value.animations.find((item) => item.targets.includes('hf-cursor'))?.path).toBeDefined();
    expect(
      (
        await editAuthoredProgram(before.source, program, [
          { kind: 'attribute', target: 'hf-title', name: 'onclick', value: 'fetch("https://example.com")' },
        ])
      ).ok,
    ).toBe(false);
    expect(unwrap(inspectAuthoredProgram(before.source, program)).source).toBe(before.source);
  });

  it('rejects source and manifest disagreement and arbitrary executable code', () => {
    expect(
      inspectAuthoredProgram(
        authoredSource.replace('data-duration="30"', 'data-duration="20"'),
        authoredFixture(),
      ).ok,
    ).toBe(false);
    expect(
      prepareAuthoredProgram(authoredSource.replace('const tl', 'fetch("https://example.com"); const tl')).ok,
    ).toBe(false);
  });

  it('adds layers inside the program and preserves their timing on reopen', async () => {
    const program = authoredFixture();
    const added = unwrap(
      await editAuthoredProgram(authoredSource, program, [
        { kind: 'add', parent: null, index: 2, html: '<p id="cta" data-hf-id="hf-cta">Try today</p>' },
      ]),
    );
    const timed = unwrap(
      await editAuthoredProgram(added.source, program, [
        {
          kind: 'timing',
          target: 'hf-cta',
          start: RationalTime.of(1200, program.canvas.rate),
          duration: RationalTime.of(600, program.canvas.rate),
        },
      ]),
    );
    expect(timed.elements.find((element) => element.id === 'hf-cta')).toMatchObject({
      start: { value: 1200 },
      duration: { value: 600 },
    });
    const removed = await editAuthoredProgram(timed.source, program, [{ kind: 'remove', target: 'hf-cta' }]);
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true });
  });

  it('removes a layer and its animation together', async () => {
    const result = await editAuthoredProgram(authoredSource, authoredFixture(), [
      { kind: 'remove', target: 'hf-cursor' },
    ]);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });
});

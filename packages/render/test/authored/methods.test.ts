// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { editAuthoredProgram, inspectAuthoredProgram } from '../../src/authored/editor';
import { authoredSourceDuration } from '../../src/authored/duration';
import { authoredFixture, authoredSource } from './support';

describe('authored animation semantics', () => {
  it.each(['set', 'to', 'from', 'fromTo'] as const)(
    'preserves %s when editing timing and easing',
    async (method) => {
      const call =
        method === 'fromTo'
          ? "tl.fromTo('#title', { x: 0 }, { x: 600, duration: 20, ease: 'none' }, 0);"
          : `tl.${method}('#title', { x: 600${method === 'set' ? '' : ", duration: 20, ease: 'none'"} }, 0);`;
      const source = authoredSource.replace(/tl\.fromTo\('#title'[^;]+;/, call);
      const program = authoredFixture();
      const before = unwrap(inspectAuthoredProgram(source, program));
      const motion = before.animations.find((entry) => entry.targets.includes('hf-title'))!;
      expect(motion.method).toBe(method);
      expect(method === 'from' ? motion.from : motion.to).toMatchObject({ x: 600 });
      const edited = unwrap(
        await editAuthoredProgram(before.source, program, [
          {
            kind: 'tween',
            target: 'hf-title',
            animationId: motion.id,
            method: motion.method,
            at: RationalTime.of(60, program.canvas.rate),
            duration: RationalTime.of(method === 'set' ? 0 : 600, program.canvas.rate),
            ease: 'power2.inOut',
            from: motion.from as Record<string, string | number>,
            to: motion.to as Record<string, string | number>,
          },
        ]),
      );
      const after = edited.animations.find((entry) => entry.targets.includes('hf-title'))!;
      expect(after.method).toBe(method);
      expect(after.at.value).toBe(60);
      expect(method === 'from' ? after.from : after.to).toMatchObject({ x: 600 });
    },
  );

  it('clamps chapter ranges for a new source end while retaining identities', () => {
    const program = authoredFixture();
    const time = (seconds: number) => RationalTime.fromSeconds(seconds, program.canvas.rate);
    program.chapters = [
      { id: 'first', name: 'First', start: time(0), duration: time(10) },
      { id: 'last', name: 'Last', start: time(10), duration: time(20) },
    ];
    expect(authoredSourceDuration(program, 15).chapters).toEqual([
      program.chapters[0],
      { ...program.chapters[1], duration: time(5) },
    ]);
    expect(authoredSourceDuration(program, 5).chapters).toEqual([
      { ...program.chapters[0], duration: time(5) },
    ]);
  });
});

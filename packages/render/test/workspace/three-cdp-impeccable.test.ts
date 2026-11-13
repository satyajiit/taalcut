// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  attachPageDiagnostics,
  buildThreeCanvasHtml,
  createSeededRng,
  DOCS_TOPICS,
  impeccableFrameCheck,
  RUNTIME_ERRORS_PROBE,
  runtimeErrorsCheck,
  TAALCUT_DOCS_TOPICS,
  TC_THREE_RUNTIME_JS,
  validateThreeSceneSpec,
} from '@taalcut/render';
import type { ProbedContent } from '../../src/workspace/frames/content-probe';

describe('Three.js deterministic bridge, CDP telemetry & Impeccable craft (WP-HFW-3D-CDP)', () => {
  it('validates ThreeSceneSpec, generates deterministic PRNG sequences, and parses TC_THREE_RUNTIME_JS', () => {
    const valid = validateThreeSceneSpec({
      id: 'hero-cube',
      compositionId: 'comp-1',
      seed: 42,
      durationSeconds: 3,
      meshes: [
        {
          id: 'cube',
          geometry: 'box',
          color: '#ff6b6b',
          keyframes: [{ atSeconds: 0.2, durationSeconds: 1.5, rotation: [0, 3.14, 0] }],
        },
      ],
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const html = buildThreeCanvasHtml(valid.value);
    expect(html).toContain('data-tc-three="hero-cube"');
    expect(html).toContain('data-composition-id="comp-1"');

    // Out-of-bounds keyframe is rejected
    const overflow = validateThreeSceneSpec({
      id: 'bad-cube',
      compositionId: 'comp-1',
      durationSeconds: 2,
      meshes: [
        {
          id: 'cube',
          geometry: 'box',
          color: '#ff6b6b',
          keyframes: [{ atSeconds: 1.5, durationSeconds: 1.0 }],
        },
      ],
    });
    expect(overflow.ok).toBe(false);

    // Seeded Mulberry32 PRNG is strictly deterministic across runs
    const rngA = createSeededRng(1337);
    const rngB = createSeededRng(1337);
    expect([rngA(), rngA(), rngA()]).toEqual([rngB(), rngB(), rngB()]);

    // In-page runtime expressions parse cleanly without requestAnimationFrame
    expect(() => new Function(`return ${TC_THREE_RUNTIME_JS};`)).not.toThrow();
    expect(() => new Function(`return ${RUNTIME_ERRORS_PROBE};`)).not.toThrow();
    expect(TC_THREE_RUNTIME_JS).not.toContain('requestAnimationFrame(');
    expect(TC_THREE_RUNTIME_JS).toContain('preserveDrawingBuffer: true');
  });

  it('captures pageerror, console.error, and WebGL diagnostics while ignoring blocked-network noise', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const fakePage = {
      on(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, listener);
      },
    };

    const diag = attachPageDiagnostics(fakePage);
    expect(runtimeErrorsCheck(diag)).toEqual({ id: 'runtimeErrors', status: 'pass' });

    // Blocked network noise is ignored (handled by the `network` gate check)
    listeners.get('console')?.({
      type: () => 'error',
      text: () => 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
    });
    expect(runtimeErrorsCheck(diag).status).toBe('pass');

    // Real console error, pageerror, and WebGL error fail the check with actionable detail
    listeners.get('console')?.({
      type: () => 'error',
      text: () => 'THREE.WebGLProgram: Shader Error 1282',
    });
    listeners.get('pageerror')?.(new Error('ReferenceError: customEase is not defined'));
    diag.recordWebglErrors(['WebGL context lost on hero-cube']);

    const check = runtimeErrorsCheck(diag);
    expect(check.id).toBe('runtimeErrors');
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('Shader Error 1282');
    expect(check.detail).toContain('customEase is not defined');
    expect(check.detail).toContain('WebGL context lost');
  });

  it('enforces Impeccable anti-slop density, hierarchy contrast, and card padding checks', () => {
    // 1. Clean lower-third (64px title + 40px role = 1.6x ratio, 24px padding) passes
    const cleanLowerThird: ProbedContent = {
      id: 'FRAMES',
      box: { x: 60, y: 1400, width: 500, height: 180 },
      texts: [
        {
          text: 'Rhea Banerjee',
          top: 1424,
          left: 100,
          right: 520,
          bottom: 1488,
          sizePx: 64,
          colour: '#ffffff',
          family: 'Poppins',
          backdrop: '#1d3557',
        },
        {
          text: 'Creative Director',
          top: 1500,
          left: 100,
          right: 420,
          bottom: 1540,
          sizePx: 40,
          colour: '#a8dadc',
          family: 'Poppins',
          backdrop: '#1d3557',
        },
      ],
    };
    expect(impeccableFrameCheck([cleanLowerThird], [1.2])).toEqual({
      id: 'impeccableCraft',
      status: 'pass',
    });

    // 2. Overcrowded 7-line wall-of-text fails
    const overcrowded: ProbedContent = {
      id: 'FRAMES',
      box: { x: 80, y: 400, width: 900, height: 800 },
      texts: Array.from({ length: 7 }, (_, i) => ({
        text: `Line ${i + 1}`,
        top: 420 + i * 90,
        left: 100,
        right: 800,
        bottom: 470 + i * 90,
        sizePx: 44,
        colour: '#ffffff',
        family: 'Poppins',
        backdrop: null,
      })),
    };
    const denseCheck = impeccableFrameCheck([overcrowded], [1.5]);
    expect(denseCheck.status).toBe('fail');
    expect(denseCheck.detail).toContain('7 text lines');

    // 3. Muddied typographic hierarchy (48px headline vs 44px subhead = 1.09x) fails
    const muddiedHierarchy: ProbedContent = {
      id: 'FRAMES',
      box: { x: 80, y: 600, width: 800, height: 220 },
      texts: [
        {
          text: 'Headline copy',
          top: 630,
          left: 110,
          right: 700,
          bottom: 678,
          sizePx: 48,
          colour: '#ffffff',
          family: 'Anton',
          backdrop: '#111111',
        },
        {
          text: 'Subhead copy',
          top: 710,
          left: 110,
          right: 680,
          bottom: 754,
          sizePx: 44,
          colour: '#cccccc',
          family: 'Poppins',
          backdrop: '#111111',
        },
      ],
    };
    const hierarchyCheck = impeccableFrameCheck([muddiedHierarchy], [2.0]);
    expect(hierarchyCheck.status).toBe('fail');
    expect(hierarchyCheck.detail).toContain('indecisive type hierarchy');

    // 4. Cramped card padding (2px padding on painted backdrop) fails
    const crampedCard: ProbedContent = {
      id: 'FRAMES',
      box: { x: 100, y: 800, width: 400, height: 70 },
      texts: [
        {
          text: 'Cramped badge',
          top: 802,
          left: 102,
          right: 498,
          bottom: 868,
          sizePx: 54,
          colour: '#000000',
          family: 'Poppins',
          backdrop: '#ffd166',
        },
      ],
    };
    const padCheck = impeccableFrameCheck([crampedCard], [0.8]);
    expect(padCheck.status).toBe('fail');
    expect(padCheck.detail).toContain('cramped card padding');
  });

  it('publishes supplemental Taalcut 3D, choreography, Impeccable craft, and sandbox-workspace topics in workspace.docs', () => {
    const topicNames = DOCS_TOPICS.map((entry) => entry.topic);
    expect(TAALCUT_DOCS_TOPICS).toHaveLength(4);
    expect(topicNames).toEqual(
      expect.arrayContaining([
        'taalcut/three-3d',
        'taalcut/choreography',
        'taalcut/impeccable-craft',
        'taalcut/sandbox-workspace',
      ]),
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';

const producerDir = realpathSync(
  join(import.meta.dirname, '..', '..', 'node_modules', '@hyperframes', 'producer'),
);
const engineDir = realpathSync(join(producerDir, '..', 'engine'));
const service = (await import(
  pathToFileURL(join(engineDir, 'dist', 'services', 'drawElementService.js')).href
)) as {
  injectDrawElementCanvas(
    page: { evaluate: (fn: (args: never) => unknown, args: unknown) => Promise<unknown> },
    width: number,
    height: number,
  ): Promise<void>;
};

afterEach(() => vi.unstubAllGlobals());

it.for([false, true])(
  'initializes the canvas API with modern=%s, drawing only the composition root',
  async (modern) => {
    class HostCanvas {}
    if (modern) Object.defineProperty(HostCanvas.prototype, 'content', { value: '' });
    vi.stubGlobal('HTMLCanvasElement', HostCanvas);
    const element = () => ({
      id: '',
      style: { cssText: '', backgroundColor: '' },
      attributes: new Map<string, string>(),
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
      appendChild: vi.fn(),
    });
    const parent = { insertBefore: vi.fn() };
    const root = { ...element(), parentNode: parent };
    const created: ReturnType<typeof element>[] = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('getComputedStyle', () => ({ opacity: '1' }));
    vi.stubGlobal('document', {
      querySelector: () => root,
      getElementById: () => null,
      createElement: () => {
        const node = element();
        created.push(node);
        return node;
      },
    });
    const page = {
      evaluate: (fn: (args: never) => unknown, args: unknown) => Promise.resolve(fn(args as never)),
    };
    await service.injectDrawElementCanvas(page, 320, 180);
    const [canvas, tick] = created;
    expect(canvas?.attributes).toEqual(new Map([modern ? ['content', 'drawable'] : ['layoutsubtree', '']]));
    expect(root.attributes).toEqual(new Map(modern ? [['drawable', '']] : []));
    expect(tick?.attributes.size).toBe(0);
    expect(parent.insertBefore).toHaveBeenCalledWith(canvas, root);
    expect(canvas?.appendChild).toHaveBeenCalledWith(root);
    expect(canvas?.appendChild).toHaveBeenCalledWith(tick);
  },
);

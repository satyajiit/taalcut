// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * window.taalcutFiles.pathFor: a dropped file's path from webUtils, null for
 * anything without one (a File the page built, a non-object, a throw).
 */
import { describe, expect, it } from 'vitest';
import { createFilesBridge, FILES_BRIDGE_KEY } from '../src/preload/files-bridge';

describe('the preload files bridge', () => {
  it('is window.taalcutFiles, as the renderer reads it', () => {
    expect(FILES_BRIDGE_KEY).toBe('taalcutFiles');
  });

  it("returns a dropped file's path", () => {
    const file = new File(['x'], 'beach.mov');
    const bridge = createFilesBridge({ getPathForFile: (f) => (f === file ? '/Users/me/beach.mov' : '') });
    expect(bridge.pathFor(file)).toBe('/Users/me/beach.mov');
  });

  it('returns null without a path or for something that is not a file', () => {
    const bridge = createFilesBridge({ getPathForFile: () => '' });
    expect(bridge.pathFor(new File(['x'], 'made-in-page.txt'))).toBeNull();
    expect(bridge.pathFor('/etc/passwd')).toBeNull();
    expect(bridge.pathFor(null)).toBeNull();
    const throwing = createFilesBridge({
      getPathForFile: () => {
        throw new TypeError('not a File');
      },
    });
    expect(throwing.pathFor({ name: 'fake' })).toBeNull();
  });
});

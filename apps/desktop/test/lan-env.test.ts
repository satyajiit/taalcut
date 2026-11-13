// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { utilityForkEnv } from '../src/main/composition/fork-env';
import { lanProcessEnv } from '../src/main/transfer/lan-env';

describe('the lan process environment (SB-15)', () => {
  const env = {
    HOME: '/Users/a',
    TMPDIR: '/tmp/x',
    PATH: '/usr/bin',
    LANG: 'en_GB.UTF-8',
    OPENAI_API_KEY: 'sk-test',
    HTTPS_PROXY: 'http://proxy:8080',
    NODE_OPTIONS: '--require /tmp/x.js',
    DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
    TAALCUT_FFMPEG_DIR: '/opt/ffmpeg',
    TAALCUT_MAC_HELPER: '/opt/helper',
    taalcut_lower: 'x',
    UNSET: undefined,
  };

  it("keeps only the base variables and Taalcut's own", () => {
    expect(lanProcessEnv(env)).toEqual({
      HOME: '/Users/a',
      TMPDIR: '/tmp/x',
      PATH: '/usr/bin',
      LANG: 'en_GB.UTF-8',
      TAALCUT_FFMPEG_DIR: '/opt/ffmpeg',
      TAALCUT_MAC_HELPER: '/opt/helper',
    });
  });

  it('applies to the lan and mcp processes only', () => {
    expect(utilityForkEnv('agent', env)).toEqual({});
    expect(utilityForkEnv('lan', env).env).toEqual(lanProcessEnv(env));
    expect(utilityForkEnv('mcp', env).env).toEqual({
      HOME: '/Users/a',
      TMPDIR: '/tmp/x',
      PATH: '/usr/bin',
      LANG: 'en_GB.UTF-8',
    });
  });
});

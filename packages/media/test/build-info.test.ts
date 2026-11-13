// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { parseConfiguration, readBuildInfo } from '../src/binaries/build-info';

const LGPL_21 =
  'ffmpeg is free software; you can redistribute it and/or\nmodify it under the terms of the GNU Lesser General Public\n' +
  'License as published by the Free Software Foundation; either\nversion 2.1 of the License, or (at your option) any later version.';

describe('parseConfiguration', () => {
  it('reads the usual one-line block', () => {
    const text =
      'ffmpeg version 9.0.2\n  configuration: --disable-gpl --enable-videotoolbox\n  libavutil 61.1.101';
    expect(parseConfiguration(text)).toEqual(['--disable-gpl', '--enable-videotoolbox']);
  });

  it('keeps reading flags wrapped onto continuation lines, and stops at the library list', () => {
    const text = [
      'ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers',
      '  built with Apple clang version 21.0.0',
      '  configuration: --prefix=/usr --disable-debug',
      '    --enable-gpl --enable-libx264',
      '  --enable-videotoolbox',
      '  libavutil      61.  1.101 / 61.  1.101',
      '  --not-a-flag-after-the-block',
    ].join('\n');
    expect(parseConfiguration(text)).toEqual([
      '--prefix=/usr',
      '--disable-debug',
      '--enable-gpl',
      '--enable-libx264',
      '--enable-videotoolbox',
    ]);
  });

  it('a wrapped --enable-gpl still overrides an LGPL licence text', () => {
    const text = 'ffmpeg version 9.0.2\n  configuration: --prefix=/usr\n  --enable-gpl\n  libavutil 61.1.101';
    expect(readBuildInfo('/x/ffmpeg', text, LGPL_21).licence).toBe('unknown');
  });

  it('returns nothing without a configuration line', () => {
    expect(parseConfiguration('ffmpeg version 9.0.2\n  libavutil 61.1.101')).toEqual([]);
  });
});

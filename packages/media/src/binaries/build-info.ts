// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads what an FFmpeg build is: its version (`-version`) and licence (`-L`).
 * PRD 10.3: Taalcut ships an LGPL build so dual licensing stays possible, so a
 * GPL or non-free binary must be detectable and refusable.
 */

export type FfmpegLicence =
  'LGPL-2.1-or-later' | 'LGPL-3.0-or-later' | 'GPL-2.0-or-later' | 'GPL-3.0-or-later' | 'nonfree' | 'unknown';

export interface BuildInfo {
  readonly path: string;
  /** e.g. '9.0.2', or a git describe string for snapshot builds. */
  readonly version: string;
  readonly licence: FfmpegLicence;
  /** The first sentence of `-L`, whitespace-normalised, for display in Settings → About. */
  readonly licenceLine: string;
  /** `./configure` flags from `-version`. */
  readonly configuration: readonly string[];
}

export function isLgpl(licence: FfmpegLicence): boolean {
  return licence === 'LGPL-2.1-or-later' || licence === 'LGPL-3.0-or-later';
}

/** 'ffmpeg version 9.0.1 Copyright …' → '9.0.1'. */
export function parseVersion(versionText: string): string | undefined {
  return /^\s*\S+ version (\S+)/m.exec(versionText)?.[1];
}

/**
 * The `./configure` flags after `configuration:`. FFmpeg prints them on one
 * line, but a wrapped block (some packagers' builds) continues on lines that
 * start with a flag; reading stops at the first line that doesn't.
 */
export function parseConfiguration(versionText: string): string[] {
  const lines = versionText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*configuration:/.test(line));
  if (start === -1) return [];
  const block = [lines[start]?.replace(/^\s*configuration:/, '') ?? ''];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+--/.test(line)) break;
    block.push(line);
  }
  return block.join(' ').split(/\s+/).filter(Boolean);
}

/**
 * Classifies the text printed by `-L`. FFmpeg prints one of five fixed texts
 * chosen by its configure flags (fftools/opt_common.c, show_license).
 */
export function classifyLicence(licenceText: string): FfmpegLicence {
  const text = licenceText.replace(/\s+/g, ' ');
  if (/nonfree parts compiled in/i.test(text)) return 'nonfree';
  const lesser = /GNU Lesser General Public License/i.test(text);
  const gpl = !lesser && /GNU General Public License/i.test(text);
  const v3 = /version 3 of the License/i.test(text);
  if (lesser) return v3 ? 'LGPL-3.0-or-later' : /version 2\.1/i.test(text) ? 'LGPL-2.1-or-later' : 'unknown';
  if (gpl)
    return v3 ? 'GPL-3.0-or-later' : /version 2 of the License/i.test(text) ? 'GPL-2.0-or-later' : 'unknown';
  return 'unknown';
}

/** First sentence of the licence text, e.g. 'ffmpeg is free software; you can redistribute it …'. */
export function licenceLine(licenceText: string): string {
  const text = licenceText.replace(/\s+/g, ' ').trim();
  const end = text.indexOf('. ');
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * Combines `-version` and `-L`. The configure flags are a cross-check: a build
 * that says LGPL but was configured with --enable-gpl or --enable-nonfree is
 * treated as unknown, which `requireLgpl` refuses.
 */
export function readBuildInfo(path: string, versionText: string, licenceText: string): BuildInfo {
  const configuration = parseConfiguration(versionText);
  let licence = classifyLicence(licenceText);
  if (configuration.includes('--enable-nonfree')) licence = 'nonfree';
  else if (isLgpl(licence) && configuration.includes('--enable-gpl')) licence = 'unknown';
  return {
    path,
    version: parseVersion(versionText) ?? 'unknown',
    licence,
    licenceLine: licenceLine(licenceText),
    configuration,
  };
}

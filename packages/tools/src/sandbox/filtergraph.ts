// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg filter graphs, parsed the way libavfilter splits them (chains on
 * `;`, filters on `,`, args ending at an unquoted `[`), so every filter in a
 * graph is checked against an allow-list before anything runs. Filters that
 * open files or sockets (movie, amovie, subtitles, ass, sendcmd, zmq, ladspa,
 * lv2, frei0r, …) are simply not on the list; the few allowed filters with a
 * file option may only write to stdout ('-').
 */

export interface ParsedFilter {
  readonly name: string;
  /** Raw args after '=', or '' */
  readonly args: string;
  readonly inputs: readonly string[];
}

/** Generators: the only filters a `-f lavfi` input may start a chain with. */
export const SOURCE_FILTERS: ReadonlySet<string> = new Set([
  'color',
  'testsrc',
  'testsrc2',
  'smptebars',
  'smptehdbars',
  'rgbtestsrc',
  'yuvtestsrc',
  'nullsrc',
  'allrgb',
  'allyuv',
  'mandelbrot',
  'sine',
  'anullsrc',
  'aevalsrc',
  'anoisesrc',
]);

/** Analysis, scaling and assembly filters the experiments need; nothing that reads or writes a path. */
const FILTERS: ReadonlySet<string> = new Set([
  ...SOURCE_FILTERS,
  'null',
  'anull',
  'copy',
  'scale',
  'scale_vt',
  'transpose_vt',
  // CUDA's filters (LGPL, --enable-cuda-llvm): frames stay on the GPU between NVDEC and a download.
  'scale_cuda',
  'transpose_cuda',
  'hwupload_cuda',
  'fps',
  'format',
  'aformat',
  'select',
  'aselect',
  'setpts',
  'asetpts',
  'settb',
  'trim',
  'atrim',
  'crop',
  'pad',
  'hflip',
  'vflip',
  'transpose',
  'setsar',
  'setdar',
  'split',
  'asplit',
  'concat',
  'overlay',
  'hstack',
  'vstack',
  'xstack',
  'tile',
  'drawbox',
  'drawgrid',
  'drawtext',
  'fade',
  'afade',
  'xfade',
  'acrossfade',
  'blend',
  'tblend',
  'eq',
  'hue',
  'colorchannelmixer',
  'lutyuv',
  'lutrgb',
  'boxblur',
  'gblur',
  'edgedetect',
  'mpdecimate',
  'thumbnail',
  'scdet',
  'metadata',
  'ametadata',
  'signalstats',
  'blackdetect',
  'freezedetect',
  'ssim',
  'psnr',
  'ebur128',
  'loudnorm',
  'volumedetect',
  'astats',
  'silencedetect',
  'aresample',
  'pan',
  'volume',
  'showwavespic',
  'showspectrumpic',
  'palettegen',
  'paletteuse',
  'zscale',
  'tonemap',
  'hwupload',
  'hwdownload',
]);

/** File options on allowed filters: by name (and alias), and the first positional slot that is one. */
const PATH_OPTIONS: Readonly<Record<string, { keys: readonly string[]; position: number }>> = {
  metadata: { keys: ['file'], position: 5 },
  ametadata: { keys: ['file'], position: 5 },
  ssim: { keys: ['stats_file', 'f'], position: 0 },
  psnr: { keys: ['stats_file', 'f'], position: 0 },
  drawtext: { keys: ['textfile', 'fontfile'], position: Number.POSITIVE_INFINITY },
};
const STDOUT = '-';
const NAME = /^([a-z][a-z0-9_]*)(@[A-Za-z0-9_]+)?$/;

/** Splits `text` on any of `separators` that is not quoted or escaped. Quotes and escapes are kept. */
export function splitUnquoted(text: string, separators: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (!quoted && char === '\\' && i + 1 < text.length) {
      current += char + text[++i]!;
      continue;
    }
    if (char === "'") quoted = !quoted;
    if (!quoted && separators.includes(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Removes one level of quoting and escaping, like av_get_token. */
export function unescape(text: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === '\\' && i + 1 < text.length) out += text[++i]!;
    else out += char;
  }
  return out.trim();
}

/** Leading `[label]`s, then the rest. */
function takeLabels(text: string): { labels: string[]; rest: string } {
  const labels: string[] = [];
  let rest = text.trimStart();
  while (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) break;
    labels.push(rest.slice(1, end));
    rest = rest.slice(end + 1).trimStart();
  }
  return { labels, rest };
}

/** The index of the first unquoted, unescaped `[` (output labels start there), or -1. */
function outputLabelsAt(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (!quoted && char === '\\') i++;
    else if (char === "'") quoted = !quoted;
    else if (!quoted && char === '[') return i;
  }
  return -1;
}

/** Parses a graph into chains of filters, or a reason it can't be read. */
export function parseFilterGraph(graph: string): { chains: ParsedFilter[][] } | { problem: string } {
  if (graph.trim().length === 0) return { problem: 'empty filter graph' };
  const chains: ParsedFilter[][] = [];
  for (const chainText of splitUnquoted(graph, ';')) {
    const chain: ParsedFilter[] = [];
    for (const filterText of splitUnquoted(chainText, ',')) {
      const { labels, rest } = takeLabels(filterText);
      const cut = outputLabelsAt(rest);
      const body = (cut < 0 ? rest : rest.slice(0, cut)).trim();
      const equals = body.indexOf('=');
      const name = (equals < 0 ? body : body.slice(0, equals)).trim();
      const match = NAME.exec(name);
      if (!match) return { problem: 'unreadable filter name' };
      chain.push({ name: match[1]!, args: equals < 0 ? '' : body.slice(equals + 1), inputs: labels });
    }
    chains.push(chain);
  }
  return { chains };
}

/**
 * Why a filter's args may not run, or null. Only file options are checked; expressions are safe.
 * Args are unescaped twice, as libavfilter does (once by the graph parser, once per option), so
 * `print\:file=…` is read as two options here exactly as FFmpeg reads it.
 */
function argsProblem(filter: ParsedFilter): string | null {
  const paths = PATH_OPTIONS[filter.name];
  if (!paths || filter.args === '') return null;
  const parts = splitUnquoted(unescape(filter.args), ':');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const equals = splitUnquoted(part, '=');
    if (equals.length > 1) {
      const key = unescape(equals[0]!).replace(/['\\]/g, '');
      const value = unescape(equals.slice(1).join('='));
      if (paths.keys.includes(key) && value !== STDOUT) return `${filter.name} may only write to stdout`;
    } else if (i >= paths.position && unescape(part) !== STDOUT) {
      return `${filter.name} may only write to stdout`;
    }
  }
  return null;
}

/**
 * Why a graph may not run, or null when every filter is allowed. `lavfi`
 * graphs (an input) must start every chain with a generator and take no input pads.
 */
export function filterGraphProblem(graph: string, options: { lavfiInput?: boolean } = {}): string | null {
  const parsed = parseFilterGraph(graph);
  if ('problem' in parsed) return parsed.problem;
  for (const chain of parsed.chains) {
    const first = chain[0]!;
    if (options.lavfiInput && (!SOURCE_FILTERS.has(first.name) || first.inputs.length > 0))
      return `lavfi input must start with a generator, not '${first.name}'`;
    for (const filter of chain) {
      if (!FILTERS.has(filter.name)) return `filter '${filter.name}' is not allowed`;
      const problem = argsProblem(filter);
      if (problem) return problem;
    }
  }
  return null;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg and ffprobe options an experiment may use, with a check for
 * each value. Anything not listed is refused: options that write files
 * (-report, -vstats_file, -passlogfile, -progress, -sdp_file, -dump_attachment),
 * read them (-filter_complex_script, -i of a list) or change protocols are
 * simply absent.
 */

export type OptionScope = 'global' | 'input' | 'output' | 'any';
export type OptionKind = 'filter' | 'format' | 'loglevel' | 'threads' | 'value';

export interface OptionRule {
  readonly arity: 0 | 1;
  readonly scope: OptionScope;
  readonly kind?: OptionKind;
  /** Null when the value is fine, else why not. */
  readonly check?: (value: string) => string | null;
  /** May carry a stream specifier (`-c:v`, `-b:a`, `-frames:v`). */
  readonly specifier?: boolean;
}

const pattern =
  (regex: RegExp, what: string) =>
  (value: string): string | null =>
    regex.test(value) ? null : `bad ${what}`;
const oneOf =
  (values: readonly string[], what: string) =>
  (value: string): string | null =>
    values.includes(value) ? null : `bad ${what}`;

const TIME = pattern(/^-?(?:\d{1,6}(?:\.\d{1,6})?|\d{1,3}:\d{2}:\d{2}(?:\.\d{1,6})?)$/, 'time');
const INT = pattern(/^\d{1,9}$/, 'integer');
const NUMBER = pattern(/^-?\d{1,9}(?:\.\d{1,6})?$/, 'number');
const NAME = pattern(/^[a-z0-9_]{1,40}$/, 'name');
const RATE = pattern(/^(?:\d{1,6}(?:\.\d{1,6})?|\d{1,6}\/\d{1,6}|ntsc|pal|film|ntsc-film)$/, 'rate');
const SIZE = pattern(/^\d{1,5}x\d{1,5}$/, 'size');
const BITRATE = pattern(/^\d{1,9}(?:\.\d{1,3})?[kKmM]?$/, 'bitrate');
const MAP = pattern(/^-?(?:\[[A-Za-z0-9_]{1,32}\]|\d{1,2}(?::[vasdt])?(?::\d{1,2})?\??)$/, 'stream map');
const SPEC = /^(?:[vasdt](?::\d{1,2})?|\d{1,2})$/;

export const LOG_LEVELS = [
  'quiet',
  'panic',
  'fatal',
  'error',
  'warning',
  'info',
  'verbose',
  'debug',
  'trace',
];
const LOGLEVEL = pattern(new RegExp(`^(?:(?:level|repeat)\\+)*(?:${LOG_LEVELS.join('|')})$`), 'log level');

const flag = (scope: OptionScope): OptionRule => ({ arity: 0, scope });
const valued = (scope: OptionScope, check: OptionRule['check'], specifier = false): OptionRule => ({
  arity: 1,
  scope,
  ...(check ? { check } : {}),
  specifier,
});

const shared: Record<string, OptionRule> = {
  hide_banner: flag('global'),
  loglevel: { arity: 1, scope: 'global', kind: 'loglevel', check: LOGLEVEL },
  v: { arity: 1, scope: 'global', kind: 'loglevel', check: LOGLEVEL },
  f: { arity: 1, scope: 'any', kind: 'format', check: NAME },
};

export const FFMPEG_OPTIONS: Readonly<Record<string, OptionRule>> = {
  ...shared,
  y: flag('global'),
  n: flag('global'),
  nostdin: flag('global'),
  nostats: flag('global'),
  stats: flag('global'),
  filter_complex: { arity: 1, scope: 'global', kind: 'filter' },
  lavfi: { arity: 1, scope: 'global', kind: 'filter' },
  threads: { arity: 1, scope: 'any', kind: 'threads', check: INT },
  filter_threads: { arity: 1, scope: 'global', kind: 'threads', check: INT },
  filter_complex_threads: { arity: 1, scope: 'global', kind: 'threads', check: INT },
  // VideoToolbox on a Mac, NVDEC through CUDA on Linux (media's hw-video rows); never a device path.
  hwaccel: valued('input', oneOf(['videotoolbox', 'cuda', 'none'], 'hwaccel')),
  hwaccel_output_format: valued('input', oneOf(['videotoolbox_vld', 'cuda'], 'hwaccel output format')),
  noautorotate: flag('input'),
  autorotate: flag('input'),
  accurate_seek: flag('input'),
  copyts: flag('global'),
  ss: valued('any', TIME),
  sseof: valued('input', TIME),
  t: valued('any', TIME),
  to: valued('any', TIME),
  itsoffset: valued('input', TIME),
  r: valued('any', RATE, true),
  s: valued('any', SIZE, true),
  pix_fmt: valued('any', NAME, true),
  c: valued('any', NAME, true),
  codec: valued('any', NAME, true),
  vcodec: valued('any', NAME),
  acodec: valued('any', NAME),
  an: flag('output'),
  vn: flag('output'),
  sn: flag('output'),
  dn: flag('output'),
  vf: { arity: 1, scope: 'output', kind: 'filter' },
  af: { arity: 1, scope: 'output', kind: 'filter' },
  filter: { arity: 1, scope: 'output', kind: 'filter', specifier: true },
  map: valued('output', MAP),
  b: valued('output', BITRATE, true),
  maxrate: valued('output', BITRATE, true),
  bufsize: valued('output', BITRATE, true),
  q: valued('output', NUMBER, true),
  qscale: valued('output', NUMBER, true),
  frames: valued('output', INT, true),
  vframes: valued('output', INT),
  aframes: valued('output', INT),
  ar: valued('any', INT, true),
  ac: valued('any', INT, true),
  sample_fmt: valued('any', NAME, true),
  update: valued('output', oneOf(['0', '1'], 'update')),
  start_number: valued('output', INT),
  frame_pts: valued('output', oneOf(['0', '1'], 'frame_pts')),
  fps_mode: valued('output', oneOf(['passthrough', 'cfr', 'vfr', 'auto'], 'fps mode'), true),
  shortest: flag('output'),
  g: valued('output', INT, true),
  profile: valued('output', NAME, true),
  level: valued('output', NUMBER, true),
  movflags: valued('output', oneOf(['faststart', '+faststart'], 'movflags')),
  aspect: valued('output', pattern(/^\d{1,5}[:/]\d{1,5}$|^\d{1,3}(?:\.\d{1,6})?$/, 'aspect'), true),
  color_primaries: valued('output', NAME, true),
  color_trc: valued('output', NAME, true),
  colorspace: valued('output', NAME, true),
  color_range: valued('output', NAME, true),
};

export const FFPROBE_OPTIONS: Readonly<Record<string, OptionRule>> = {
  ...shared,
  show_format: flag('global'),
  show_streams: flag('global'),
  show_frames: flag('global'),
  show_packets: flag('global'),
  show_chapters: flag('global'),
  show_programs: flag('global'),
  show_error: flag('global'),
  count_frames: flag('global'),
  count_packets: flag('global'),
  pretty: flag('global'),
  sexagesimal: flag('global'),
  of: valued(
    'global',
    pattern(/^(?:json|csv|flat|ini|default|compact|xml)(?:=[a-z0-9_=:]{0,64})?$/, 'format'),
  ),
  print_format: valued(
    'global',
    pattern(/^(?:json|csv|flat|ini|default|compact|xml)(?:=[a-z0-9_=:]{0,64})?$/, 'format'),
  ),
  show_entries: valued('global', pattern(/^[a-z_=,:]{1,400}$/, 'entries')),
  select_streams: valued('global', pattern(SPEC, 'stream specifier')),
  read_intervals: valued('global', pattern(/^[0-9%+:.,#-]{1,200}$/, 'intervals')),
};

/** Demuxers an experiment's file inputs may use (passed as `-format_whitelist`). */
export const INPUT_DEMUXERS = [
  'mov',
  'matroska',
  'webm',
  'avi',
  'mpegts',
  'mp3',
  'wav',
  'aac',
  'flac',
  'ogg',
  'aiff',
  'caf',
  'w64',
  'h264',
  'hevc',
  'm4v',
  'image2',
  'png_pipe',
  'jpeg_pipe',
  'webp_pipe',
] as const;

/** Muxers an output file may use. */
export const OUTPUT_MUXERS = [
  'image2',
  'mp4',
  'mov',
  'matroska',
  'webm',
  'wav',
  'null',
  'rawvideo',
  'f32le',
  's16le',
  'mjpeg',
  'apng',
  'gif',
  'framemd5',
  'framecrc',
  'md5',
  'ffmetadata',
  'data',
] as const;

/** Muxers that may write to stdout ('-'). */
export const STDOUT_MUXERS = [
  'null',
  'rawvideo',
  'f32le',
  's16le',
  'framemd5',
  'framecrc',
  'md5',
  'ffmetadata',
];

/** Output file extensions FFmpeg guesses a safe muxer from, when there's no `-f`. */
export const OUTPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'mp4', 'mov', 'm4a', 'mkv', 'wav'];

/** `-c:v` → `{ base: 'c', specifier: 'v' }`; null when the specifier is malformed. */
export function splitOption(name: string): { base: string; specifier: string | null } | null {
  const colon = name.indexOf(':');
  if (colon < 0) return { base: name, specifier: null };
  const specifier = name.slice(colon + 1);
  return SPEC.test(specifier) ? { base: name.slice(0, colon), specifier } : null;
}

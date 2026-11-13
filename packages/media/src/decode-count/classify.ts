// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one FFmpeg or ffprobe command does to video, read from its arguments
 * (IX-D6): a probe, a whole-stream video decode, a partial one (a seek, a
 * frame or end limit), or no video decode at all (audio only, raw frames
 * piped in, an encoder listing). Pure, so the counting rules are tested
 * without a process, like the hardware session weight.
 */
import { basename, resolve } from 'node:path';

export type CommandKind = 'ffprobe' | 'ffmpeg' | 'other';

export interface CommandClass {
  readonly kind: CommandKind;
  /** 'none' when the command decodes no video stream of a file. */
  readonly decode: 'full' | 'partial' | 'none';
  /** The files whose video it decodes, resolved, without FFmpeg's `file:` prefix. */
  readonly inputs: readonly string[];
}

/** Inputs FFmpeg reads as raw frames or samples: no video decode happens. */
const RAW_INPUT_FORMATS = new Set(['rawvideo', 's16le', 'f32le', 'image2pipe', 'lavfi']);
/** Output limits that stop a decode before the end of the stream. */
const LIMIT_FLAGS = new Set(['-frames:v', '-vframes', '-t', '-to', '-frames']);
const FILTER_FLAG = /^-(?:vf|filter(?::v)?(?::\d+)?|filter_complex|lavfi)$/;

/** The binaries counted by name (`ffmpeg`, `ffmpeg.exe`, `ffprobe-arm64`); anything else is `other`. */
const COUNTED: readonly CommandKind[] = ['ffmpeg', 'ffprobe'];

function commandKind(command: string): CommandKind {
  const name = basename(command).toLowerCase();
  return COUNTED.find((kind) => name.startsWith(kind)) ?? 'other';
}

/** `file:/a/b.mov` and `/a/b.mov` name the same file. */
export function inputPath(arg: string): string {
  return resolve(arg.startsWith('file:') ? arg.slice('file:'.length) : arg);
}

interface Input {
  readonly path: string;
  readonly seeked: boolean;
  readonly raw: boolean;
}

function inputsOf(args: readonly string[]): Input[] {
  const inputs: Input[] = [];
  let seeked = false;
  let format: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '-ss' || arg === '-sseof') seeked = true;
    else if (arg === '-f' && value !== undefined) format = value;
    else if (arg === '-i' && value !== undefined) {
      inputs.push({
        path: inputPath(value),
        seeked,
        raw: format !== undefined && RAW_INPUT_FORMATS.has(format),
      });
      seeked = false;
      format = undefined;
      i++;
    }
  }
  return inputs;
}

/** Whether the command reads a video stream at all: not `-vn`, and a video map, filter or default stream. */
function decodesVideo(args: readonly string[]): boolean {
  if (args.includes('-vn')) return false;
  const maps = args.flatMap((arg, i) => (arg === '-map' && args[i + 1] !== undefined ? [args[i + 1]!] : []));
  if (maps.length > 0) return maps.some((map) => /:[vV](?::|$)/.test(map) || map.startsWith('['));
  return true;
}

/**
 * An output limit or a trim ends the decode early. Not after a `select`: an
 * unseeked run that picks frames decodes from the start up to the last one it
 * keeps (the old thumbnail read 90 % of the file for one frame), so it counts as full.
 */
function limited(args: readonly string[]): boolean {
  const filters = args.filter((_, i) => i > 0 && FILTER_FLAG.test(args[i - 1]!)).join(';');
  if (/\btrim=/.test(filters)) return true;
  if (/\bselect=/.test(filters)) return false;
  const firstInput = args.indexOf('-i');
  return args.some((arg, i) => i > firstInput && LIMIT_FLAGS.has(arg));
}

export function classifyCommand(command: string, args: readonly string[]): CommandClass {
  const kind = commandKind(command);
  if (kind !== 'ffmpeg') return { kind, decode: 'none', inputs: [] };
  const files = inputsOf(args).filter((input) => !input.raw);
  if (files.length === 0 || !decodesVideo(args)) return { kind, decode: 'none', inputs: [] };
  const partial = files.some((input) => input.seeked) || limited(args);
  return { kind, decode: partial ? 'partial' : 'full', inputs: files.map((input) => input.path) };
}

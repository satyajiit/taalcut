// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stream facts for the format checks (docs/qa-gate.md, "Stream facts"):
 * one ffprobe run with -count_packets, plus a top-level MP4 box scan in
 * TypeScript (is `moov` before `mdat`, i.e. faststart).
 */
import { open } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { ProbeFailed, runProcess, type MediaContext } from '@taalcut/media';

const ENTRIES =
  'stream=codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,width,height,sample_aspect_ratio,' +
  'display_aspect_ratio,r_frame_rate,avg_frame_rate,field_order,color_range,color_space,color_transfer,' +
  'color_primaries,start_time,duration,duration_ts,time_base,nb_read_packets,sample_rate,channels,bit_rate' +
  ':stream_side_data=rotation:format=format_name,duration,size,bit_rate';

export interface StreamFact {
  readonly type: string;
  readonly codec?: string;
  readonly tag?: string;
  readonly profile?: string;
  readonly level?: number;
  readonly pixFmt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sar?: string;
  readonly dar?: string;
  readonly rFrameRate?: string;
  readonly avgFrameRate?: string;
  readonly fieldOrder?: string;
  readonly colorRange?: string;
  readonly colorSpace?: string;
  readonly colorTransfer?: string;
  readonly colorPrimaries?: string;
  readonly startTime?: number;
  readonly duration?: number;
  readonly durationTs?: number;
  readonly timeBase?: string;
  readonly packets?: number;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly bitRate?: number;
  /** Degrees from the display matrix, 0 when absent. */
  readonly rotation: number;
}

export interface StreamFacts {
  readonly formatName: string;
  readonly duration: number;
  readonly size: number;
  readonly video: readonly StreamFact[];
  readonly audio: readonly StreamFact[];
  /** Top-level boxes in file order. */
  readonly boxes: readonly string[];
  readonly faststart: boolean;
}

const num = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '' || value === 'N/A') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

function streamFact(raw: Record<string, unknown>): StreamFact {
  const sideData = Array.isArray(raw.side_data_list) ? (raw.side_data_list as Record<string, unknown>[]) : [];
  const rotation = sideData.map((entry) => num(entry.rotation)).find((value) => value !== undefined) ?? 0;
  const fields: Record<string, unknown> = {
    type: str(raw.codec_type) ?? 'unknown',
    codec: str(raw.codec_name),
    tag: str(raw.codec_tag_string),
    profile: str(raw.profile),
    level: num(raw.level),
    pixFmt: str(raw.pix_fmt),
    width: num(raw.width),
    height: num(raw.height),
    sar: str(raw.sample_aspect_ratio),
    dar: str(raw.display_aspect_ratio),
    rFrameRate: str(raw.r_frame_rate),
    avgFrameRate: str(raw.avg_frame_rate),
    fieldOrder: str(raw.field_order),
    colorRange: str(raw.color_range),
    colorSpace: str(raw.color_space),
    colorTransfer: str(raw.color_transfer),
    colorPrimaries: str(raw.color_primaries),
    startTime: num(raw.start_time),
    duration: num(raw.duration),
    durationTs: num(raw.duration_ts),
    timeBase: str(raw.time_base),
    packets: num(raw.nb_read_packets),
    sampleRate: num(raw.sample_rate),
    channels: num(raw.channels),
    bitRate: num(raw.bit_rate),
    rotation,
  };
  // Drop absent fields so the type's optional keys stay absent (exactOptionalPropertyTypes-friendly).
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as unknown as StreamFact;
}

/** ffprobe's JSON parsed into facts; pure, so the format checks are tested on recorded output too. */
export function parseStreamFacts(json: unknown, boxes: readonly string[]): StreamFacts {
  const root = (json ?? {}) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  const streams = (root.streams ?? []).map(streamFact);
  const format = root.format ?? {};
  const moov = boxes.indexOf('moov');
  const mdat = boxes.indexOf('mdat');
  return {
    formatName: str(format.format_name) ?? '',
    duration: num(format.duration) ?? 0,
    size: num(format.size) ?? 0,
    video: streams.filter((stream) => stream.type === 'video'),
    audio: streams.filter((stream) => stream.type === 'audio'),
    boxes,
    faststart: moov >= 0 && (mdat < 0 || moov < mdat),
  };
}

/** The top-level MP4 boxes in order (types only), reading 16 bytes per box header. */
export async function scanTopLevelBoxes(path: string, limit = 64): Promise<string[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    const boxes: string[] = [];
    let offset = 0;
    while (offset + 8 <= size && boxes.length < limit) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (boxSize === 1 && bytesRead >= 16) boxSize = Number(header.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - offset;
      if (boxSize < 8) break;
      boxes.push(type);
      offset += boxSize;
    }
    return boxes;
  } finally {
    await handle.close();
  }
}

export async function readStreamFacts(ctx: MediaContext, path: string, signal?: AbortSignal): AsyncResult<StreamFacts> {
  const probed = await runProcess(
    ctx.binaries.ffprobe,
    ['-v', 'error', '-count_packets', '-show_entries', ENTRIES, '-of', 'json', path],
    { timeoutMs: 120_000, ...(signal ? { signal } : {}) },
  );
  if (!probed.ok) return probed;
  if (probed.value.exitCode !== 0)
    return err(ProbeFailed({ name: 'render' }, { detail: probed.value.stderrTail.slice(-2000) }));
  try {
    const json: unknown = JSON.parse(probed.value.stdout.toString('utf8'));
    return ok(parseStreamFacts(json, await scanTopLevelBoxes(path)));
  } catch (cause) {
    return err(ProbeFailed({ name: 'render' }, { detail: String(cause) }));
  }
}

/** '30000/1001' → [30000, 1001]; '0/0' and junk → undefined. */
export function parseRatio(text: string | undefined): readonly [number, number] | undefined {
  const match = /^(\d+)[/:](\d+)$/.exec(text ?? '');
  if (!match) return undefined;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a <= 0 || b <= 0) return undefined;
  return [a, b];
}

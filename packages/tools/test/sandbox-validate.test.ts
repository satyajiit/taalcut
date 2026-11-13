// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Argument validation (P2-T2): what may run, before anything does. No child starts here. */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ok, type SandboxRunRequest } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filterGraphProblem, parseFilterGraph } from '../src/sandbox/filtergraph';
import { prepareRun, type SandboxPrograms } from '../src/sandbox/validate';
import { tempRoot } from './helpers/sandbox';

let root: { root: string; cleanup: () => void };
let dir: string;
let outside: string;
const programs: SandboxPrograms = {
  ffmpeg: '/bin/echo',
  ffprobe: '/bin/echo',
  macHelper: '/bin/echo',
  ytDlp: async () =>
    ok({ binary: '/bin/echo', deno: '/bin/cat', ffmpegDir: '/bin', componentDirs: ['/usr/bin'] }),
};

beforeEach(() => {
  root = tempRoot();
  dir = join(root.root, 'exp');
  outside = join(root.root, 'outside');
  mkdirSync(join(dir, 'frames'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(dir, 'clip.mp4'), 'x');
  writeFileSync(join(outside, 'secret.mp4'), 'x');
  symlinkSync(outside, join(dir, 'link'));
});
afterEach(() => root.cleanup());

const prepare = (request: SandboxRunRequest, extra: Partial<SandboxPrograms> = {}) =>
  prepareRun(request, { dir, programs: { ...programs, ...extra }, threads: 4 });
const ffmpeg = (...args: string[]) => prepare({ program: 'ffmpeg', args });

async function rejected(promise: ReturnType<typeof prepare>) {
  const result = await promise;
  expect(result.ok).toBe(false);
  return result.ok ? null : result.error;
}

describe('programs and network', () => {
  it('refuses a program off the list', async () => {
    const error = await rejected(prepare({ program: 'bash' as never, args: [] }));
    expect(error?.code).toBe('sandbox.program_not_allowed');
  });

  it('only the fetcher goes online, and it must', async () => {
    expect((await rejected(prepare({ program: 'ffmpeg', args: [], network: 'outbound' })))?.code).toBe(
      'sandbox.argument_rejected',
    );
    expect((await rejected(prepare({ program: 'ytDlp', args: [] })))?.code).toBe('sandbox.argument_rejected');
  });

  it('an unconfigured program is unavailable, never something else', async () => {
    const error = await rejected(prepare({ program: 'macHelper', args: [] }, { macHelper: undefined }));
    expect(error?.code).toBe('sandbox.unavailable');
    const fetcher = await rejected(
      prepare({ program: 'ytDlp', args: [], network: 'outbound' }, { ytDlp: undefined }),
    );
    expect(fetcher?.code).toBe('sandbox.unavailable');
  });

  it('refuses too many or too long arguments and missing granted inputs', async () => {
    expect((await rejected(ffmpeg(...Array.from({ length: 513 }, () => '-y'))))?.code).toBe(
      'sandbox.argument_rejected',
    );
    expect((await rejected(ffmpeg('x'.repeat(9000))))?.params).toEqual({
      index: 0,
      reason: 'argument too long',
    });
    const missing = await rejected(
      prepare({ program: 'ffprobe', args: ['input:0'], inputs: ['/nowhere/x.mp4'] }),
    );
    expect(missing?.params).toEqual({ index: -1, reason: 'granted input is not a file' });
    const many = Array.from({ length: 17 }, () => join(outside, 'secret.mp4'));
    expect((await rejected(prepare({ program: 'ffprobe', args: [], inputs: many })))?.code).toBe(
      'sandbox.argument_rejected',
    );
  });
});

describe('ffmpeg', () => {
  it('turns scratch paths into file: paths behind the protocol and demuxer allow-lists', async () => {
    const result = await ffmpeg(
      '-hwaccel',
      'videotoolbox',
      '-i',
      'scratch:clip.mp4',
      '-vf',
      'fps=2',
      'scratch:frames/%03d.png',
    );
    expect(result.ok).toBe(true);
    const args = result.ok ? result.value.args : [];
    expect(args.slice(0, 5)).toEqual(['-nostdin', '-loglevel', 'info', '-filter_threads', '4']);
    expect(args).toContain(`file:${join(dir, 'clip.mp4')}`);
    expect(args).toContain(`file:${join(dir, 'frames', '%03d.png')}`);
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
    expect(args[args.indexOf('-format_whitelist') + 1]).toContain('mov');
    expect(args.filter((arg) => arg === '-threads')).toHaveLength(2);
  });

  it('takes the NVDEC/NVENC device path: -hwaccel cuda, CUDA frames, the CUDA filters and the download', async () => {
    const result = await ffmpeg(
      '-hwaccel',
      'cuda',
      '-hwaccel_output_format',
      'cuda',
      '-i',
      'scratch:clip.mp4',
      '-vf',
      'transpose_cuda=dir=clock,scale_cuda=w=320:h=180,hwdownload,format=nv12,hwupload_cuda',
      'scratch:o.mp4',
    );
    expect(result.ok).toBe(true);
    expect(
      filterGraphProblem('scale_cuda=w=64:h=64,transpose_cuda=dir=cclock,hwdownload,format=nv12'),
    ).toBeNull();
    expect(
      (await rejected(ffmpeg('-hwaccel_output_format', 'vaapi', '-i', 'scratch:clip.mp4', 'scratch:o.png')))
        ?.params,
    ).toEqual({ index: 1, reason: 'bad hwaccel output format' });
  });

  it('refuses network inputs and absolute paths', async () => {
    for (const input of [
      'http://127.0.0.1/x.mp4',
      'tcp://127.0.0.1:9',
      '/etc/passwd',
      'file:/etc/passwd',
      'pipe:0',
    ]) {
      const error = await rejected(ffmpeg('-i', input, 'scratch:out.png'));
      expect(error?.params).toEqual({ index: 1, reason: 'input must be a scratch: or input: path' });
    }
  });

  it('refuses paths that leave the experiment, by .. or by a link', async () => {
    expect((await rejected(ffmpeg('-i', 'scratch:../outside/secret.mp4', 'scratch:o.png')))?.code).toBe(
      'sandbox.path_outside',
    );
    expect((await rejected(ffmpeg('-i', 'scratch:link/secret.mp4', 'scratch:o.png')))?.code).toBe(
      'sandbox.path_outside',
    );
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', 'scratch:link/out.png')))?.code).toBe(
      'sandbox.path_outside',
    );
    expect(
      (await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-f', 'image2', 'scratch:experiment.json')))?.code,
    ).toBe('sandbox.path_outside');
    expect((await rejected(ffmpeg('-i', 'scratch:missing.mp4', 'scratch:o.png')))?.params).toEqual({
      index: 1,
      reason: 'no such file',
    });
  });

  it('reads granted inputs by number only', async () => {
    const granted = join(outside, 'secret.mp4');
    const result = await prepare({
      program: 'ffmpeg',
      args: ['-i', 'input:0', '-frames:v', '1', 'scratch:o.png'],
      inputs: [granted],
    });
    expect(result.ok && result.value.args).toContain(`file:${granted}`);
    expect(result.ok && result.value.inputs).toEqual([granted]);
    expect((await rejected(ffmpeg('-i', 'input:3', 'scratch:o.png')))?.params).toEqual({
      index: 1,
      reason: 'no such input',
    });
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', 'input:0')))?.code).toBe(
      'sandbox.argument_rejected',
    );
  });

  it('refuses options off the list, including the ones that write or read files', async () => {
    for (const option of [
      '-report',
      '-vstats_file',
      '-progress',
      '-filter_complex_script',
      '-dump_attachment',
      '-protocol_whitelist',
    ]) {
      const error = await rejected(ffmpeg(option, 'x', '-i', 'scratch:clip.mp4', 'scratch:o.png'));
      expect(error?.params).toEqual({ index: 0, reason: 'option not allowed' });
    }
    expect(
      (await rejected(ffmpeg('-hwaccel', 'vaapi', '-i', 'scratch:clip.mp4', 'scratch:o.png')))?.params,
    ).toEqual({
      index: 1,
      reason: 'bad hwaccel',
    });
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-c:zz', 'png', 'scratch:o.png')))?.code).toBe(
      'sandbox.argument_rejected',
    );
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-vframes')))?.params).toEqual({
      index: 2,
      reason: 'missing value',
    });
    expect((await rejected(ffmpeg('-i')))?.params).toEqual({ index: 0, reason: 'missing input' });
  });

  it('checks every filter graph against the allow-list', async () => {
    for (const graph of [
      'movie=/etc/passwd',
      'amovie=x.wav',
      'subtitles=x.srt',
      'sendcmd=f=cmds.txt',
      'zmq',
      'scale=320:-2,metadata=print:file=/tmp/x.txt',
      'metadata=print\\:file=/tmp/x.txt',
      "metadata=mode=print:file='/tmp/x'",
      'drawtext=textfile=/etc/passwd',
      'ssim=stats.log',
    ]) {
      const error = await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-vf', graph, '-f', 'null', '-'));
      expect(error?.params?.index).toBe(3);
    }
    const fine = await ffmpeg(
      '-i',
      'scratch:clip.mp4',
      '-vf',
      'scdet=threshold=5,metadata=print:file=-',
      '-f',
      'null',
      '-',
    );
    expect(fine.ok).toBe(true);
    const complex = await ffmpeg(
      '-filter_complex',
      '[0:v]split[a][b];[a][b]hstack[out]',
      '-i',
      'scratch:clip.mp4',
      '-map',
      '[out]',
      'scratch:o.png',
    );
    expect(complex.ok && complex.value.args).toContain('-filter_complex_threads');
  });

  it('takes lavfi only with generator sources', async () => {
    const good = await ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'color=red:size=64x64:duration=1',
      '-frames:v',
      '1',
      'scratch:o.png',
    );
    expect(good.ok).toBe(true);
    for (const graph of ['movie=/etc/passwd', '[in]scale=10:10', 'scale=10:10']) {
      expect((await rejected(ffmpeg('-f', 'lavfi', '-i', graph, 'scratch:o.png')))?.params?.index).toBe(3);
    }
    expect((await rejected(ffmpeg('-f', 'hls', '-i', 'scratch:clip.mp4', 'scratch:o.png')))?.params).toEqual({
      index: 1,
      reason: 'demuxer not allowed',
    });
  });

  it('allows a few muxers, stdout only for stream muxers, and needs an output', async () => {
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-f', 'tee', 'scratch:o.mp4')))?.params).toEqual({
      index: 3,
      reason: 'muxer not allowed',
    });
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-f', 'image2', '-')))?.code).toBe(
      'sandbox.argument_rejected',
    );
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', 'scratch:o.txt')))?.params).toEqual({
      index: 2,
      reason: 'output needs -f or a known extension',
    });
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4')))?.params).toEqual({
      index: 2,
      reason: 'no output',
    });
    expect((await rejected(ffmpeg('-i', 'scratch:clip.mp4', 'scratch:o.png', '-y', '-an')))?.params).toEqual({
      index: 4,
      reason: 'option after the last output',
    });
    expect((await rejected(ffmpeg('-an', '-i', 'scratch:clip.mp4', 'scratch:o.png')))?.params).toEqual({
      index: 0,
      reason: 'output option before an input',
    });
    expect(
      (await rejected(ffmpeg('-i', 'scratch:clip.mp4', '-hwaccel', 'videotoolbox', 'scratch:o.png')))?.params,
    ).toEqual({
      index: 2,
      reason: 'input option before an output',
    });
    const stdout = await ffmpeg('-i', 'scratch:clip.mp4', '-f', 'null', '-');
    expect(stdout.ok && stdout.value.args.at(-3)).toBe('pipe:1');
  });

  it('forces the thread limit and keeps a log level that shows the CPU signal', async () => {
    const result = await ffmpeg(
      '-loglevel',
      'error',
      '-threads',
      '64',
      '-i',
      'scratch:clip.mp4',
      '-threads',
      '64',
      'scratch:o.png',
    );
    const args = result.ok ? result.value.args : [];
    expect(args).not.toContain('64');
    expect(args[args.indexOf('-loglevel') + 1]).toBe('info');
    const verbose = await ffmpeg('-v', 'level+debug', '-i', 'scratch:clip.mp4', 'scratch:o.png');
    expect(verbose.ok && verbose.value.args[2]).toBe('level+debug');
  });
});

describe('ffprobe', () => {
  it('takes options and one input', async () => {
    const result = await prepare({
      program: 'ffprobe',
      args: ['-v', 'error', '-of', 'json', '-show_streams', 'scratch:clip.mp4'],
    });
    expect(result.ok && result.value.args.at(-1)).toBe(`file:${join(dir, 'clip.mp4')}`);
    const probe = (args: string[]) => rejected(prepare({ program: 'ffprobe', args }));
    expect((await probe(['-o', 'x', 'scratch:clip.mp4']))?.params).toEqual({
      index: 0,
      reason: 'option not allowed',
    });
    expect((await probe(['scratch:clip.mp4', '-i', 'scratch:clip.mp4']))?.params).toEqual({
      index: 2,
      reason: 'one input only',
    });
    expect((await probe(['-show_format']))?.params).toEqual({ index: 1, reason: 'no input' });
    expect((await probe(['http://x/y']))?.code).toBe('sandbox.argument_rejected');
    expect((await probe(['-f', 'hls', 'scratch:clip.mp4']))?.params).toEqual({
      index: 1,
      reason: 'demuxer not allowed',
    });
    expect((await probe(['-i']))?.params).toEqual({ index: 0, reason: 'missing input' });
  });
});

describe('mac helper', () => {
  const helper = (args: string[]) => prepare({ program: 'macHelper', args });
  it('allows ocr on a scratch file only', async () => {
    writeFileSync(join(dir, 'f.png'), 'x');
    const result = await helper(['ocr', '--input', 'scratch:f.png', '--languages', 'en-US,hi', '--fast']);
    expect(result.ok && result.value.args).toEqual([
      'ocr',
      '--input',
      join(dir, 'f.png'),
      '--languages',
      'en-US,hi',
      '--fast',
    ]);
    expect((await rejected(helper(['asr.load'])))?.params).toEqual({
      index: 0,
      reason: 'only the ocr subcommand',
    });
    expect((await rejected(helper(['ocr', '--input', 'input:0'])))?.code).toBe('sandbox.argument_rejected');
    expect(
      (await rejected(helper(['ocr', '--languages', '$(rm)', '--input', 'scratch:f.png'])))?.params?.index,
    ).toBe(2);
    expect((await rejected(helper(['ocr', '--fast'])))?.params).toEqual({
      index: 2,
      reason: 'missing --input',
    });
    expect((await rejected(helper(['ocr', '--input', 'scratch:f.png', '--json'])))?.params?.index).toBe(3);
  });
});

describe('filter graph parser', () => {
  it('splits chains and filters the way libavfilter does', () => {
    const parsed = parseFilterGraph("[0:v]scale=320:-2,select='eq(pict_type\\,I)'[a];[a]null");
    expect('chains' in parsed && parsed.chains.map((chain) => chain.map((filter) => filter.name))).toEqual([
      ['scale', 'select'],
      ['null'],
    ]);
    expect(filterGraphProblem('')).toBe('empty filter graph');
    expect(filterGraphProblem('mo\\vie=x')).toBe('unreadable filter name');
    expect(filterGraphProblem('metadata=print:key=a:value=b:function=same_str:expr=1:-')).toBeNull();
    expect(filterGraphProblem('metadata=print:key=a:value=b:function=same_str:expr=1:/tmp/x')).not.toBeNull();
  });
});

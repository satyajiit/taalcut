// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A built yt-dlp, run for real before it is packed: `--version`, then one extraction from a local page (yt-dlp's
 * generic extractor finds the page's <video>, downloads it and names it from the page's <title>), plain and under
 * the reference fetcher's own sandbox profile with the parameters the app passes. Nothing touches the network
 * beyond 127.0.0.1.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const FIXTURE_TITLE = 'Taalcut fixture clip';

/** Deterministic bytes standing in for a video: yt-dlp's direct download doesn't decode them. */
export function fixtureClip(size = 262144) {
  const out = Buffer.alloc(size);
  let block = Buffer.from('taalcut-fixture');
  for (let at = 0; at < size; at += 32) {
    block = createHash('sha256').update(block).digest();
    block.copy(out, at, 0, Math.min(32, size - at));
  }
  return out;
}

/** Serves the page and the clip on 127.0.0.1; { url, clipSha256, requests, close }. */
export async function startFixture() {
  const clip = fixtureClip();
  const page = `<!doctype html><html><head><title>${FIXTURE_TITLE}</title></head><body><video controls src="clip.mp4"></video></body></html>\n`;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url === '/index.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
    if (req.url === '/clip.mp4') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : clip.length - 1;
        return res
          .writeHead(206, {
            'content-type': 'video/mp4',
            'content-range': `bytes ${start}-${end}/${clip.length}`,
            'accept-ranges': 'bytes',
          })
          .end(clip.subarray(start, end + 1));
      }
      return res
        .writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': clip.length,
          'accept-ranges': 'bytes',
        })
        .end(req.method === 'HEAD' ? undefined : clip);
    }
    return res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/index.html`,
    clipSha256: createHash('sha256').update(clip).digest('hex'),
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** yt-dlp's arguments for the fixture: no config, no cache, the file's path and the title printed. */
export function extractionArgs(url, outDir) {
  return [
    '--no-config',
    '--ignore-config',
    '--no-cache-dir',
    '--no-progress',
    '-P',
    outDir,
    '-o',
    'clip.%(ext)s',
    '--print',
    'title',
    '--print',
    'after_move:filepath',
    url,
  ];
}

/** What's wrong with an extraction's printed output and file (empty: nothing). */
export async function extractionProblems(stdout, { outDir, clipSha256 }) {
  const lines = stdout.trim().split('\n');
  const problems = [];
  // The generic extractor numbers a page's HTML5 media entries: "<title> (1)".
  if (lines[0] !== `${FIXTURE_TITLE} (1)`) problems.push(`title printed as ${JSON.stringify(lines[0])}`);
  const expected = join(outDir, 'clip.mp4');
  if (lines[1] !== expected) problems.push(`saved as ${JSON.stringify(lines[1])}, expected ${expected}`);
  else {
    const sha = createHash('sha256')
      .update(await readFile(expected))
      .digest('hex');
    if (sha !== clipSha256) problems.push(`the saved file's sha256 is ${sha}, the page served ${clipSha256}`);
  }
  return problems;
}

/** The fetcher profile's parameters for a run of `executable` whose component folder is `componentDir`. */
export function sandboxParams({ scratch, home, executable, componentDir }) {
  const unused = '/dev/null';
  return [
    ['SCRATCH', scratch],
    ['MANIFEST', join(scratch, 'manifest.json')],
    ['HOME', home],
    ['PROGRAM', executable],
    ['PROGRAM_DIR', componentDir],
    ['TMPDIR', join(scratch, 'tmp')],
    ['DENO', unused],
    ['DENO_HOME', unused],
    ['FFMPEG', unused],
    ['FFPROBE', unused],
    ['FFMPEG_DIR', unused],
    ['COMPONENT_0', componentDir],
    ['COMPONENT_1', unused],
    ['COMPONENT_2', unused],
    ['COMPONENT_3', unused],
  ];
}

/**
 * Runs the checks on the built tree; throws with every problem. `componentDir` holds `yt-dlp` and `_internal/`,
 * `scratch` is an empty folder, `profile` the fetcher's .sb file.
 */
export async function checkBuild({ componentDir, version, scratch, home, profile }) {
  const executable = join(componentDir, 'yt-dlp');
  const env = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LANG: 'en_US.UTF-8' };
  await mkdir(env.TMPDIR, { recursive: true });
  const { stdout: printed } = await exec(executable, ['--version'], { env });
  if (printed.trim() !== version)
    throw new Error(`yt-dlp --version printed ${printed.trim()}, expected ${version}`);
  const fixture = await startFixture();
  const problems = [];
  try {
    const plainOut = join(scratch, 'plain');
    const plain = await exec(executable, extractionArgs(fixture.url, plainOut), { env });
    problems.push(
      ...(await extractionProblems(plain.stdout, { outDir: plainOut, clipSha256: fixture.clipSha256 })),
    );
    const boxedOut = join(scratch, 'sandboxed');
    const params = sandboxParams({ scratch, home, executable, componentDir }).flatMap(([k, v]) => [
      '-D',
      `${k}=${v}`,
    ]);
    const boxed = await exec(
      '/usr/bin/sandbox-exec',
      ['-f', profile, ...params, executable, ...extractionArgs(fixture.url, boxedOut)],
      { env },
    );
    problems.push(
      ...(await extractionProblems(boxed.stdout, { outDir: boxedOut, clipSha256: fixture.clipSha256 })).map(
        (p) => `sandboxed: ${p}`,
      ),
    );
  } finally {
    await fixture.close();
  }
  if (problems.length > 0) throw new Error(`the built yt-dlp failed its run:\n  ${problems.join('\n  ')}`);
  return { version: printed.trim(), requests: fixture.requests.length };
}

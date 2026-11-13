// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX on a Linux NVIDIA host: a fresh profile installs its components from a local release
 * (TAALCUT_DEV_COMPONENTS, roots/dev-components.ts) and indexes real phone clips on CUDA. In Settings › Models the
 * person reviews and accepts NVIDIA's terms (the acknowledgement the jobs process reads) and presses Download; ONNX
 * Runtime's CUDA build, the CUDA runtime, PP-OCRv5 Latin and whisper-server's CUDA build come from the release over
 * loopback, the models it doesn't rebuild from components.taalcut.app. The app starts again (glibc reads
 * LD_LIBRARY_PATH when a process starts: the jobs process forked before cuda-runtime-13 was installed can't load
 * CUDA's provider, as LNX1's GPU setup says), then Add folder imports the clips and every stage finishes, none failed
 * or waiting. On CUDA: the jobs process loads onnxruntime-cuda's binding and maps ONNX Runtime's CUDA provider and
 * the component's libcudart; no OCR, embedding or whisper session failed on CUDA or fell back; whisper-server runs
 * its CUDA build.
 *
 * Opt-in, never in CI: TAALCUT_DEV_COMPONENTS names the release, TAALCUT_IDX_CLIPS a folder of clips, and
 * TAALCUT_IDX_OUT where the profile and the evidence go (kept). Needs the test build (pnpm e2e:gate's build) and
 * an NVIDIA GPU; run it under the GPU lock where machines are shared.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addFolder, openIndexingApp, type IndexingApp } from './indexing-app';
import { describeFailures, indexProgress, stageRows } from './indexing-support';

const RELEASE = process.env.TAALCUT_DEV_COMPONENTS;
const CLIPS = process.env.TAALCUT_IDX_CLIPS;
const OUT = process.env.TAALCUT_IDX_OUT;
const gpus = (() => {
  try {
    return execFileSync('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
})();
test.skip(
  process.platform !== 'linux' || !RELEASE || !CLIPS || !OUT || gpus === '',
  'Opt-in: an NVIDIA Linux host with TAALCUT_DEV_COMPONENTS, TAALCUT_IDX_CLIPS and TAALCUT_IDX_OUT',
);

/** The components the indexing on this host needs, as the download picks them after NVIDIA's terms. */
const CUDA_SET = [
  'onnxruntime-cuda',
  'cuda-runtime-13',
  'ppocr-v5-latin',
  'whisper-server-cuda',
  'embeddinggemma-2',
];

let running: IndexingApp | undefined;
let sampler: ReturnType<typeof setInterval> | undefined;
test.afterAll(async () => {
  if (sampler) clearInterval(sampler);
  await running?.app.close().catch(() => undefined);
});

function installedIds(userData: string): string[] {
  try {
    const registry = JSON.parse(readFileSync(join(userData, 'components', 'registry.json'), 'utf8')) as {
      components?: Record<string, unknown>;
    };
    return Object.keys(registry.components ?? {}).sort();
  } catch {
    return [];
  }
}

/** Which processes hold GPU memory now: pid and MiB, from nvidia-smi. */
function gpuProcesses(): [string, number][] {
  try {
    return execFileSync(
      'nvidia-smi',
      ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(',').map((part) => part.trim()) as [string, string])
      .map(([pid, mib]) => [pid, Number(mib)]);
  } catch {
    return [];
  }
}

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/**
 * A process by what it is: whisper-server, or Electron's process type (utility processes are Taalcut's). Chromium
 * rewrites a child's title over its argv, one string with spaces, so the arguments split on both.
 */
function what(pid: string): string {
  const args = read(`/proc/${pid}/cmdline`).split(/[\0 ]/);
  if (args[0]?.endsWith('whisper-server')) return 'whisper-server';
  const type = args.find((arg) => arg.startsWith('--type='))?.slice(7) ?? 'main';
  const sub = args.find((arg) => arg.startsWith('--utility-sub-type='))?.slice(19);
  return sub ? `${type} ${sub}` : type;
}

/** Every process under `root`, by /proc's parent links. */
function descendants(root: number): string[] {
  const parents = new Map<string, string>();
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    const stat = read(`/proc/${pid}/stat`);
    const ppid = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1];
    if (ppid) parents.set(pid, ppid);
  }
  const under = (pid: string): boolean => {
    for (let at: string | undefined = pid; at; at = parents.get(at)) if (at === String(root)) return true;
    return false;
  };
  return [...parents.keys()].filter(under);
}

/** The CUDA libraries a process has mapped: ONNX Runtime's CUDA provider and cudart, by path. */
function cudaMappings(pid: string): string[] {
  const paths = read(`/proc/${pid}/maps`)
    .split('\n')
    .map((line) => line.slice(line.indexOf('/')))
    .filter((path) => /libonnxruntime_providers_cuda\.so|libcudart\.so|libcublas\.so/.test(path));
  return [...new Set(paths)];
}

const ENV = (out: string, fallbackLog: string) => {
  const xdg = (name: string) => {
    const dir = join(out, 'profile', name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    TAALCUT_DEV_COMPONENTS: RELEASE!,
    TAALCUT_COMPUTE_FALLBACK_LOG: fallbackLog,
    HOME: xdg('home'),
    XDG_CONFIG_HOME: xdg('config'),
    XDG_CACHE_HOME: xdg('cache'),
    XDG_DATA_HOME: xdg('data'),
  };
};

/** The jobs process's log of the latest launch (e2e/launch.ts writes app-logs-<n>). */
function latestJobsLog(): string {
  const dir = test.info().outputPath();
  const runs = readdirSync(dir)
    .filter((name) => name.startsWith('app-logs-'))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
  return read(join(dir, runs.at(-1) ?? '', 'jobs.log'));
}

test('a fresh profile installs from a local release and indexes the clips on CUDA', async () => {
  test.setTimeout(3 * 60 * 60_000);
  const out = OUT!;
  rmSync(join(out, 'profile'), { recursive: true, force: true });
  const userData = join(out, 'profile', 'userData');
  const fallbackLog = join(out, 'compute-fallbacks.jsonl');
  rmSync(fallbackLog, { force: true });
  const env = ENV(out, fallbackLog);
  const clips = readdirSync(CLIPS!).filter((name) => /\.(mp4|mov)$/i.test(name));
  expect(clips.length).toBeGreaterThan(0);
  running = await openIndexingApp(userData, CLIPS!, env);
  const evidence: Record<string, unknown> = { gpus, release: RELEASE, clips };

  // Settings › Models: NVIDIA's terms first (the CUDA builds wait for them), then the download.
  await running.page.goto('app://taalcut/settings/models');
  const review = running.page.getByRole('button', { name: 'Review terms and install' });
  await review.waitFor({ timeout: 120_000 });
  await review.click();
  await running.page.locator('[data-action=accept-terms]').click();
  const download = running.page.locator('[data-action=download-models]');
  if (await download.isVisible({ timeout: 15_000 }).catch(() => false)) await download.click();
  const started = Date.now();
  await expect
    .poll(() => CUDA_SET.filter((id) => !installedIds(userData).includes(id)), {
      timeout: 90 * 60_000,
      intervals: [5_000],
      message: 'the CUDA set to install',
    })
    .toEqual([]);
  evidence['installed'] = installedIds(userData);
  evidence['installMs'] = Date.now() - started;
  evidence['installLog'] = latestJobsLog()
    .split('\n')
    .filter((line) => line.includes('[components]'));

  // The CUDA runtime came after the jobs process started: start the app again, as LNX1's GPU setup asks.
  await running.app.close();
  running = await openIndexingApp(userData, CLIPS!, env);
  const main = running.app.process().pid!;

  // What holds the GPU and maps CUDA while the clips index, every 5 s.
  const gpu = new Map<string, number>();
  const mapped = new Map<string, Set<string>>();
  sampler = setInterval(() => {
    const ours = new Set(descendants(main));
    for (const [pid, mib] of gpuProcesses())
      if (ours.has(pid)) gpu.set(what(pid), Math.max(gpu.get(what(pid)) ?? 0, mib));
    for (const pid of ours)
      for (const path of cudaMappings(pid))
        mapped.set(what(pid), (mapped.get(what(pid)) ?? new Set()).add(path));
  }, 5_000);

  await addFolder(running.page);
  const indexed = Date.now();
  await expect
    .poll(
      () => {
        const progress = indexProgress(userData, clips.length);
        if (progress.failed.length > 0) throw new Error(describeFailures(progress.failed));
        return progress.settled;
      },
      { timeout: 120 * 60_000, intervals: [10_000], message: 'every stage of every clip to finish' },
    )
    .toBe(true);
  clearInterval(sampler);
  evidence['indexMs'] = Date.now() - indexed;
  evidence['gpuMemoryMiB'] = Object.fromEntries(gpu);
  evidence['cudaMapped'] = Object.fromEntries([...mapped].map(([process, paths]) => [process, [...paths]]));

  const rows = stageRows(userData);
  evidence['stages'] = rows.map(
    (row) => `${row.fileName} ${row.stage} ${row.state}${row.reasonKey ? ` (${row.reasonKey})` : ''}`,
  );
  const jobsLog = latestJobsLog().split('\n');
  evidence['gpuLog'] = jobsLog.filter((line) =>
    /\[components\] onnxruntime binding|whisper-server on|cuda|compute\.fallback/i.test(line),
  );
  const fallbacks = read(fallbackLog).trim().split('\n').filter(Boolean);
  evidence['computeFallbacks'] = fallbacks;
  writeFileSync(join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  // Every stage finished; OCR, embeddings and language on every clip (on-screen text vectors only where there was text).
  expect(rows.filter((row) => row.state !== 'done' && row.state !== 'skipped')).toEqual([]);
  for (const stage of ['vision.ocr', 'vision.embed', 'audio.language'])
    expect(rows.filter((row) => row.stage === stage).map((row) => row.state)).toEqual(
      clips.map(() => 'done'),
    );
  expect(
    rows.filter(
      (row) =>
        row.stage === 'vision.embedOcr' && row.state !== 'done' && row.reasonKey !== 'indexing.skip.noText',
    ),
  ).toEqual([]);
  // On CUDA: the CUDA build's binding, no session that failed on CUDA or fell back, whisper-server's CUDA build, and
  // the CUDA provider and the component's cudart mapped in a utility process.
  expect(jobsLog.some((line) => line.includes('onnxruntime binding from onnxruntime-cuda'))).toBe(true);
  expect(
    jobsLog.filter((line) => /cuda (accelerator_failed|out_of_memory)|didn't load on cuda/.test(line)),
  ).toEqual([]);
  expect(jobsLog.some((line) => line.includes('whisper-server on cuda'))).toBe(true);
  const operations = fallbacks.map((line) => (JSON.parse(line) as { operation: string }).operation);
  expect(operations.filter((operation) => /ocr|embed|language|transcri|whisper/i.test(operation))).toEqual(
    [],
  );
  const utility = [...mapped]
    .filter(([process]) => process.startsWith('utility'))
    .flatMap(([, paths]) => [...paths]);
  expect(utility).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/installed\/onnxruntime-cuda\/.*libonnxruntime_providers_cuda\.so/),
      expect.stringMatching(/installed\/cuda-runtime-13\/.*libcudart\.so/),
    ]),
  );
});

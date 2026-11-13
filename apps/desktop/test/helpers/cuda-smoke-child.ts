// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The process linux-components-host.test.ts starts (node --import tsx), as a utility process would be: the
 * component-natives hook installed for a packaged app (so the binding can only come from a component), then an
 * ONNX Runtime session on CUDA alone, with CPU fallback refused, one inference, and whether nvidia-smi lists this
 * process on the GPU. Prints one JSON line: { binding, ok, error?, output?, onGpu? }.
 *
 *   node --import tsx cuda-smoke-child.ts <componentsRoot>
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type * as OnnxRuntime from 'onnxruntime-node';
import { installComponentNatives } from '../../src/utility/component-natives';
import { tinyMatMulRelu } from './tiny-onnx';

type Ort = typeof OnnxRuntime;

const [componentsRoot] = process.argv.slice(2);
if (!componentsRoot) throw new Error('usage: cuda-smoke-child.ts <componentsRoot>');
const logs: string[] = [];
installComponentNatives({ componentsRoot, packaged: true, log: (message) => logs.push(message) });
const ort = createRequire(import.meta.url)('onnxruntime-node') as Ort;

function onGpu(): boolean {
  const apps = execFileSync('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader'], {
    encoding: 'utf8',
  });
  return apps.split('\n').some((line) => line.trim() === String(process.pid));
}

/** The one line the parent reads (stdout, not the console: the parent parses it). */
const report = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);

const n = 256;
try {
  const session = await ort.InferenceSession.create(tinyMatMulRelu(n, 0.5), {
    executionProviders: ['cuda'],
    extra: { session: { disable_cpu_ep_fallback: '1' } },
  });
  // Ones through a 0.5 matrix: every output is n / 2.
  const x = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, n]);
  const { Y } = await session.run({ X: x });
  const output = Y ? Array.from((Y.data as Float32Array).slice(0, 4)) : [];
  report({ binding: logs, ok: true, output, onGpu: onGpu() });
  await session.release();
} catch (error) {
  report({ binding: logs, ok: false, error: String(error).slice(0, 600) });
}

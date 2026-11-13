// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for `whisper-server`, run with `node --import tsx`: the same arguments, routes and answers, no model.
 * The model file's name picks the behaviour:
 * - `gpu-broken`: dies loading with a Metal error unless started with `-ng`;
 * - `no-gpu`: says it found no GPU and serves on the CPU;
 * - `crash-once`: exits in the middle of its first inference (a `<model>.crashed` file remembers it did);
 * - `slow`: an inference takes 5 s, printing progress, and stops when its request is closed.
 * Every inference appends a line to `<model>.log`: `<pid> <fields as JSON>`.
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const model = value('-m') ?? '';
const name = basename(model);
const base = value('--request-path') ?? '';
const port = Number(value('--port'));
const cpu = flag('-ng');

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
  });
}

/** The multipart form's text fields (the file part is skipped). */
function fieldsOf(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of text.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g))
    if (match[1] !== undefined && match[2] !== undefined) fields[match[1]] = match[2];
  return fields;
}

function answer(fields: Record<string, string>): object {
  const probabilities = { es: 0.82, pt: 0.12, en: 0.01 };
  if (fields.detect_language === 'true')
    return {
      language: 'es',
      detected_language_probability: 0.82,
      language_probabilities: probabilities,
      segments: [],
    };
  return {
    language: fields.language === 'auto' ? 'es' : fields.language,
    segments: [
      {
        words: [
          { word: ' Hola', start: 0.1, end: 0.5, probability: 0.9, t_dtw: 12 },
          { word: ' mundo', start: 0.5, end: 1.02, probability: 0.8, t_dtw: -1 },
        ],
      },
    ],
    ...(fields.no_language_probabilities === 'true' ? {} : { language_probabilities: probabilities }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (name.includes('gpu-broken') && !cpu) {
  console.error('ggml_metal_init: error: failed to create MTLDevice');
  setTimeout(() => process.exit(1), 50);
} else {
  console.error(
    cpu || name.includes('no-gpu')
      ? 'whisper_backend_init_gpu: no GPU found'
      : 'whisper_backend_init_gpu: using Metal backend',
  );
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === `${base}/health`) {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
        return;
      }
      if (request.url !== `${base}/inference` || request.method !== 'POST') {
        response.writeHead(404).end();
        return;
      }
      const fields = fieldsOf(await body(request));
      appendFileSync(`${model}.log`, `${process.pid} ${JSON.stringify(fields)}\n`);
      if (name.includes('crash-once') && !existsSync(`${model}.crashed`)) {
        writeFileSync(`${model}.crashed`, '');
        process.exit(3);
      }
      if (name.includes('slow')) {
        let closed = false;
        response.on('close', () => (closed = true));
        for (let percent = 10; percent <= 100 && !closed; percent += 10) {
          console.error(`whisper_print_progress_callback: progress = ${percent}%`);
          await sleep(500);
        }
        if (closed) {
          appendFileSync(`${model}.log`, `${process.pid} aborted\n`);
          return;
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer(fields)));
    })();
  });
  server.listen(port, '127.0.0.1');
  process.on('SIGTERM', () => process.exit(0));
}

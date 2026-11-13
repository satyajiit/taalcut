// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for llama.cpp's llama-server (b11571) in tests, and for
 * taalcut-mlx-server (MLX1), which takes the same flags it shares: it answers
 * /health with 503 while "loading" and 200 after, requires the key from
 * LLAMA_API_KEY (TAALCUT_MLX_API_KEY for the MLX server) like the real ones, and streams one Chat
 * Completions answer whose text reports what the request carried. Switches,
 * set by the test's spawn port: FAKE_LOAD_MS (default 150), FAKE_EXIT_ON_GPU
 * (exit 1 while loading unless --n-gpu-layers is 0, like a failed Metal
 * init; FAKE_GPU_ERROR is what it prints), FAKE_NEVER_READY, FAKE_DEVICES (what `--list-devices` prints, rows
 * split by `;`).
 */
import http from 'node:http';

const args = process.argv.slice(2);
if (args.includes('--list-devices')) {
  const rows = ['Available devices:', ...(process.env.FAKE_DEVICES ?? '').split(';').filter(Boolean)];
  // Nothing below runs: the process exits once the rows are out.
  await new Promise(() => process.stdout.write(`${rows.join('\n')}\n`, () => process.exit(0)));
}
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const alias = flag('--alias') ?? 'model';
const gpu = flag('--n-gpu-layers') !== '0';
const apiKey = process.env.LLAMA_API_KEY ?? process.env.TAALCUT_MLX_API_KEY;
const engine = process.env.TAALCUT_MLX_API_KEY ? 'mlx' : 'llama.cpp';
const loadMs = Number(process.env.FAKE_LOAD_MS ?? 150);
const startedAt = Date.now();
const ready = () => !process.env.FAKE_NEVER_READY && Date.now() - startedAt >= loadMs;

if (gpu && process.env.FAKE_EXIT_ON_GPU) {
  setTimeout(() => {
    console.error(process.env.FAKE_GPU_ERROR ?? 'ggml_metal_init: error: failed to allocate buffer');
    process.exit(1);
  }, 30);
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const chunk = (delta, finish = null, usage) =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1_760_000_000,
    model: alias,
    choices: usage ? [] : [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  })}\n\n`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    return ready()
      ? send(res, 200, { status: 'ok' })
      : send(res, 503, { error: { code: 503, message: 'Loading model', type: 'unavailable_error' } });
  }
  if (!apiKey || req.headers.authorization !== `Bearer ${apiKey}`) {
    return send(res, 401, { error: { code: 401, message: 'Invalid API Key', type: 'authentication_error' } });
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (data) => (raw += data));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const images = body.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((part) => part.type === 'image_url').length;
      const report = { served: alias, engine, kwargs: body.chat_template_kwargs ?? null, gpu, images };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk({ role: 'assistant', content: '' }));
      res.write(chunk({ content: JSON.stringify(report) }));
      res.write(chunk({}, 'stop'));
      res.write(chunk({}, null, { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }));
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  send(res, 404, { error: { code: 404, message: 'File Not Found', type: 'not_found_error' } });
});

server.listen(Number(flag('--port')), flag('--host'), () => {
  console.error(`main: server is listening on http://${flag('--host')}:${flag('--port')}`);
});
process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

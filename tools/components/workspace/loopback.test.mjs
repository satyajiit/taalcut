// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** loopback.cjs (AGT2 sbx): a server asking for any port gets the shell's next free loopback port. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, test } from 'node:test';

const exec = promisify(execFile);
const SHIM = fileURLToPath(new URL('./loopback.cjs', import.meta.url));
const { anyPortRequest } = createRequire(import.meta.url)(SHIM);

/** `count` loopback ports free now. */
async function freePorts(count) {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise((resolve) => {
          const server = createServer().listen(0, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

describe('loopback.cjs', () => {
  test('rewrites only a request for any port on loopback or every address', () => {
    assert.ok(anyPortRequest([0, '127.0.0.1', () => {}]));
    assert.ok(anyPortRequest([() => {}]));
    assert.ok(anyPortRequest([{ port: 0, host: '127.0.0.1' }]));
    assert.ok(anyPortRequest([{ host: '::' }]));
    assert.equal(anyPortRequest([8080, '127.0.0.1']), null);
    assert.equal(anyPortRequest(['/tmp/socket']), null);
    assert.equal(anyPortRequest([0, '192.168.1.2']), null);
    assert.equal(anyPortRequest([{ path: '/tmp/x' }]), null);
  });

  test("gives each server the next of the shell's ports, past one taken by someone else", async () => {
    const ports = await freePorts(3);
    const taken = await new Promise((resolve) => {
      const server = createServer().listen(ports[0], '127.0.0.1', () => resolve(server));
    });
    try {
      const script = [
        "const net = require('node:net');",
        'const a = net.createServer().listen(0, () => {',
        "  const b = net.createServer().listen({ port: 0, host: '127.0.0.1' }, () => {",
        '    console.log(a.address().address, a.address().port, b.address().port);',
        '    a.close(); b.close();',
        '  });',
        '});',
      ].join('\n');
      const { stdout } = await exec(process.execPath, ['--require', SHIM, '-e', script], {
        env: { ...process.env, TAALCUT_SHELL_PORTS: ports.join(',') },
      });
      assert.equal(stdout.trim(), `127.0.0.1 ${ports[1]} ${ports[2]}`);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  test('changes nothing without TAALCUT_SHELL_PORTS', async () => {
    const { stdout } = await exec(
      process.execPath,
      [
        '--require',
        SHIM,
        '-e',
        "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port > 0); s.close(); });",
      ],
      { env: { ...process.env, TAALCUT_SHELL_PORTS: '' } },
    );
    assert.equal(stdout.trim(), 'true');
  });
});

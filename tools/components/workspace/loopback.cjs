// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use strict';

/**
 * The workspace shell's loopback ports (AGT2 sbx). workspace.sb opens only the loopback ports TAALCUT_SHELL_PORTS
 * lists (a few, free when the command started), so a server that asks for any port (0) on loopback or on every
 * address is given the first of them not taken, on 127.0.0.1. The HyperFrames CLI's file server is such a server,
 * and Chrome loads the composition from it. Loaded with `node --require` by the hyperframes-cli component's shims,
 * shipped as its lib/taalcut-loopback.cjs. A server asking for a port of its own, a path or a handle is untouched.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- node --require preloads CommonJS
const net = require('node:net');

const ports = String(process.env.TAALCUT_SHELL_PORTS || '')
  .split(',')
  .map(Number)
  .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
const ANY = new Set([undefined, null, '', '127.0.0.1', 'localhost', '::1', '::', '0.0.0.0']);

/** `listen`'s arguments as { port, host, backlog, callback }, or null when they name a path, a handle or a port. */
function anyPortRequest(args) {
  const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
  const rest = callback ? args.slice(0, -1) : args;
  const [first, second, third] = rest;
  if (first !== null && typeof first === 'object') {
    if (first.path !== undefined || first.fd !== undefined || first.handle !== undefined || first._handle)
      return null;
    if (first.port !== undefined && Number(first.port) !== 0) return null;
    if (!ANY.has(first.host)) return null;
    return { backlog: first.backlog, callback, exclusive: first.exclusive };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  if (first !== undefined && Number(first) !== 0) return null;
  const host = typeof second === 'string' ? second : undefined;
  if (!ANY.has(host)) return null;
  const backlog = typeof second === 'number' ? second : typeof third === 'number' ? third : undefined;
  return { backlog, callback };
}

if (ports.length > 0) {
  const listen = net.Server.prototype.listen;
  const attempt = (server, index, request) => {
    const emit = server.emit;
    server.emit = function (event, ...rest) {
      if (event === 'error' && rest[0] && rest[0].code === 'EADDRINUSE' && index + 1 < ports.length) {
        server.emit = emit;
        setImmediate(() => attempt(server, index + 1, { ...request, callback: undefined }));
        return true;
      }
      if (event === 'listening' || event === 'error') server.emit = emit;
      return emit.call(this, event, ...rest);
    };
    const options = { port: ports[index], host: '127.0.0.1' };
    if (request.backlog !== undefined) options.backlog = request.backlog;
    if (request.exclusive !== undefined) options.exclusive = request.exclusive;
    return request.callback ? listen.call(server, options, request.callback) : listen.call(server, options);
  };
  net.Server.prototype.listen = function (...args) {
    const request = anyPortRequest(args);
    return request ? attempt(this, 0, request) : listen.apply(this, args);
  };
}

module.exports = { anyPortRequest, ports };

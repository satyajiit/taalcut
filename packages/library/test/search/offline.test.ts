// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 "Network: none": search and find similar run with every outbound socket refused. */
import net from 'node:net';
import tls from 'node:tls';
import { unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchFixture } from './search-helpers';

afterEach(() => vi.restoreAllMocks());

describe('search offline', () => {
  it('opens no socket and makes no request', async () => {
    const s = searchFixture();
    const attempts: string[] = [];
    const refuse = (what: string) => () => {
      attempts.push(what);
      throw new Error(`network refused: ${what}`);
    };
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(refuse('net.Socket.connect'));
    vi.spyOn(net, 'connect').mockImplementation(refuse('net.connect'));
    vi.spyOn(net, 'createConnection').mockImplementation(refuse('net.createConnection'));
    vi.spyOn(tls, 'connect').mockImplementation(refuse('tls.connect'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(refuse('fetch'));

    const found = unwrap(await s.search.search('pôr do sol na praia', { minQuality: 0.2 }, 20));
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.degraded).toBeUndefined();
    unwrap(await s.search.findSimilar(found.hits[0]!.shot.id, undefined, 10, true));
    expect(attempts).toEqual([]);
  });
});

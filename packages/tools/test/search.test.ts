// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { tokenize } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { fakeServices, mediaModule, registryWith } from './helpers';
import { createTestDomainTools } from './test-domain';

describe('tokenize', () => {
  it('splits camelCase and dots, drops stopwords, folds plurals', () => {
    expect(tokenize('testdomain.captionFrame')).toEqual(['testdomain', 'caption', 'frame']);
    expect(tokenize('List the clips in my library')).toEqual(['list', 'clip', 'library']);
    expect(tokenize('stories glass bus x')).toEqual(['story', 'glass', 'bus']);
  });
});

describe('search', () => {
  const registry = registryWith(mediaModule, createTestDomainTools(fakeServices()));
  const top = (query: string) => registry.search(query)[0]?.name;

  it('ranks the right tool first for plain-language needs', () => {
    expect(top('describe what is in this frame')).toBe('testdomain.captionFrame');
    expect(top('delete a clip')).toBe('testdomain.deleteClip');
    expect(top('ffprobe metadata of a video file')).toBe('media.probe');
    expect(top('rename')).toBe('testdomain.renameClip');
    expect(top('share link upload')).toBe('testdomain.shareClip');
  });

  it('matches word prefixes at a lower weight', () => {
    expect(top('capt')).toBe('testdomain.captionFrame');
    expect(registry.search('cap')).toEqual([]);
  });

  it('returns compact entries with scores, best first, honouring limit and filters', () => {
    const hits = registry.search('clip', { limit: 2 });
    expect(hits).toHaveLength(2);
    expect(Object.keys(hits[0]!).sort()).toEqual(['family', 'name', 'score', 'summary']);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(registry.search('clip', { sideEffects: ['read'] }).map((h) => h.name)).toEqual([
      'testdomain.listClips',
    ]);
    expect(registry.search('video', { families: ['media'] }).map((h) => h.name)).toEqual(['media.probe']);
  });

  it('finds nothing for unknown words or stopwords only', () => {
    expect(registry.search('quantum entanglement')).toEqual([]);
    expect(registry.search('what is the')).toEqual([]);
    expect(registryWith().search('anything')).toEqual([]);
  });

  it('rebuilds the index when a module is added', () => {
    const growing = registryWith(mediaModule);
    expect(growing.search('caption')).toEqual([]);
    growing.register(createTestDomainTools(fakeServices()));
    expect(growing.search('caption')[0]?.name).toBe('testdomain.captionFrame');
  });
});

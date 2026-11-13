// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ok, unwrap, type ToolModule } from '@taalcut/core';
import { createToolRegistry, ToolRegistrationFailed } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fakeServices, fxModule, fxTool, mediaModule, registryWith } from './helpers';
import { createTestDomainTools } from './test-domain';

const run = async () => ok({ n: 1 });

function registrationProblems(module: ToolModule): string {
  const registry = registryWith(mediaModule);
  const result = registry.register(module);
  expect(result.ok).toBe(false);
  if (result.ok) return '';
  expect(ToolRegistrationFailed.is(result.error)).toBe(true);
  expect(result.error.params).toEqual({ module: module.id });
  // Atomic: nothing from a failed module is registered.
  expect(registry.moduleIds()).toEqual(['media']);
  return result.error.detail ?? '';
}

describe('registration', () => {
  it('registers modules and describes each tool', () => {
    const registry = registryWith(mediaModule, createTestDomainTools(fakeServices()));
    expect(registry.moduleIds()).toEqual(['media', 'testdomain']);
    expect(registry.describe('testdomain.countWords')).toEqual({
      name: 'testdomain.countWords',
      callName: 'testdomain_countWords',
      version: '1.0.0',
      module: 'testdomain',
      family: 'testdomain',
      summary: 'Counts the words in a piece of text, such as a caption or a transcript line.',
      description: 'Counts the words in a piece of text, such as a caption or a transcript line.',
      tags: ['text', 'statistics'],
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1000,
      retry: { maxAttempts: 1, initialDelayMs: 0 },
      permission: {},
      cacheable: true,
      checkpoint: false,
      alwaysAsk: false,
      savesProgress: false,
      requiresApproval: false,
      estimatesCost: false,
      idempotent: false,
      exposure: { mcp: true },
    });
  });

  it('returns the descriptors it registered and keeps optional metadata', () => {
    const registry = registryWith();
    const tool = fxTool({
      run,
      family: 'search',
      cache: { ttlMs: 500 },
      checkpoint: true,
      summary: 'Short.',
    });
    const descriptors = unwrap(registry.register(fxModule(tool)));
    expect(descriptors[0]).toMatchObject({
      family: 'search',
      cacheTtlMs: 500,
      checkpoint: true,
      summary: 'Short.',
    });
    // LRN1-CTX: a tool that saves the step's progress says so (it can't be cached).
    const saving = fxTool({ run, name: 'fx.savePage', savesProgress: true });
    expect(unwrap(registryWith().register(fxModule(saving)))[0]).toMatchObject({ savesProgress: true });
  });

  it('lists every metadata problem in the module at once', () => {
    const detail = registrationProblems(
      fxModule(fxTool({ run, version: 'one' }), fxTool({ run, name: 'other.thing', timeoutMs: -1 })),
    );
    expect(detail).toContain("fx.thing: version 'one' is not semver");
    expect(detail).toContain("other.thing: name must start with 'fx.'");
    expect(detail).toContain('other.thing: timeoutMs must be a positive integer');
  });

  it('refuses a module registered twice', () => {
    expect(registrationProblems(mediaModule)).toBe("module 'media' is already registered");
  });

  it('refuses the same major version twice but allows two majors side by side', () => {
    expect(
      registrationProblems(fxModule(fxTool({ run, version: '1.0.0' }), fxTool({ run, version: '1.1.0' }))),
    ).toBe('fx.thing: major version 1 is declared twice');
    const registry = registryWith(
      fxModule(fxTool({ run, version: '1.4.0' }), fxTool({ run, version: '2.0.0' })),
    );
    expect(registry.resolve('fx.thing')?.descriptor.version).toBe('2.0.0');
    expect(registry.resolve('fx.thing', '^1.2.0')?.descriptor.version).toBe('1.4.0');
    expect(registry.describe('fx_thing', '1')?.version).toBe('1.4.0');
    expect(registry.resolve('fx.thing', '3')).toBeUndefined();
    expect(registry.catalogue()).toEqual([{ name: 'fx.thing', summary: 'A test tool.', family: 'fx' }]);
  });

  it('refuses schemas that JSON Schema cannot express and inputs that are not objects', () => {
    expect(registrationProblems(fxModule(fxTool({ run, input: z.object({ at: z.date() }) })))).toMatch(
      /fx\.thing: schema can't be exported to JSON Schema \(.+\)/,
    );
    expect(registrationProblems(fxModule(fxTool({ run, input: z.string() })))).toBe(
      'fx.thing: input schema must be a z.object()',
    );
  });

  it('createToolRegistry stops at the first failing module', () => {
    const result = createToolRegistry([mediaModule, mediaModule]);
    expect(!result.ok && result.error.code).toBe('tools.registration_failed');
    expect(unwrap(createToolRegistry()).catalogue()).toEqual([]);
  });
});

describe('catalogue, describe and resolve', () => {
  const registry = registryWith(mediaModule, createTestDomainTools(fakeServices()));

  it('filters the catalogue by family, side effect and cost class', () => {
    expect(registry.catalogue({ sideEffects: ['destructive', 'external'] }).map((e) => e.name)).toEqual([
      'testdomain.deleteClip',
      'testdomain.shareClip',
    ]);
    expect(registry.catalogue({ costClasses: ['cloud'] }).map((e) => e.name)).toEqual([
      'testdomain.captionFrame',
    ]);
    expect(registry.catalogue({ families: ['media'] })).toHaveLength(1);
  });

  it('resolves names and call names, and returns undefined for unknown tools', () => {
    expect(registry.resolve('testdomain_renameClip')?.descriptor.name).toBe('testdomain.renameClip');
    expect(registry.describe('nope.nothing')).toBeUndefined();
  });
});

describe('loadSchemas', () => {
  const registry = registryWith(mediaModule, createTestDomainTools(fakeServices()));

  it('loads only the requested tools, by name or call name', () => {
    const schemas = unwrap(registry.loadSchemas(['media_probe', 'testdomain.renameClip']));
    expect(schemas.map((s) => s.name)).toEqual(['media.probe', 'testdomain.renameClip']);
    expect(schemas[1]?.inputSchema).toMatchObject({ required: ['id', 'title'] });
    expect(schemas[0]?.inputSchema).not.toHaveProperty('$schema');
  });

  it('fails on an unknown tool', () => {
    const result = registry.loadSchemas(['media.probe', 'media.nothing']);
    expect(!result.ok && result.error).toMatchObject({
      code: 'tools.not_found',
      params: { tool: 'media.nothing' },
    });
  });

  it('exports other JSON Schema targets on demand and memoises them', () => {
    const first = unwrap(registry.loadSchemas(['media.probe'], { target: 'draft-07' }))[0];
    const second = unwrap(registry.loadSchemas(['media.probe'], { target: 'draft-07' }))[0];
    expect(second?.inputSchema).toBe(first?.inputSchema);
    expect(first?.inputSchema).toMatchObject({ type: 'object' });
  });
});

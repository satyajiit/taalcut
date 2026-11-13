// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { isBrandIconId } from '#components/brand/brand-icon';
import { claimViolations } from '#content/claims';
import { HINT, LOOK } from '#components/showcase/plugins/meta';
import {
  AGENT_APPS,
  AGENT_LEVELS,
  AGENT_WORDS,
  ASK,
  LEVEL_STEPS,
  PLUGIN_VIEWS,
  PLUGINS,
  POSTIZ_POST,
} from '#components/showcase/plugins/plugins-data';
import { statusOf } from '#components/showcase/plugins/use-plugins';
import { filesUnder, read } from './source-files';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('Settings › Plugins', () => {
  it('has the build’s two plugins only: Postiz and Instagram Edits', () => {
    expect(PLUGINS.map((p) => p.name)).toEqual(['Postiz', 'Instagram Edits']);
    const words = strings(PLUGINS).join(' ');
    expect(words).not.toMatch(/comfy|wordpress|store|marketplace|third[- ]party/i);
  });

  it('gives each plugin its four views, in the app’s words', () => {
    expect(PLUGIN_VIEWS.map((v) => v.label)).toEqual(['Connection', 'Access', 'Tools', 'Skills']);
    for (const p of PLUGINS) {
      expect(p.access.length, p.id).toBeGreaterThan(1);
      expect(p.features.length, p.id).toBeGreaterThan(1);
      expect(p.tools.length, p.id).toBeGreaterThan(1);
      expect(p.skills.length, p.id).toBeGreaterThan(1);
      for (const t of p.tools) expect(['Read', 'External action']).toContain(t.effect);
      for (const s of p.skills) expect(s.steps.length).toBeGreaterThan(1);
    }
  });

  it('says Postiz in words (SVGL has no icon for it) and Instagram Edits with its icon', () => {
    expect(isBrandIconId('postiz')).toBe(false);
    expect(isBrandIconId('instagram')).toBe(true);
  });

  it('calls a plugin Active only once it is connected and on', () => {
    const none = new Set<string>();
    expect(statusOf({ saved: false, tested: false, granted: none, enabled: false })).toBe('Not connected');
    expect(statusOf({ saved: true, tested: true, granted: none, enabled: false })).toBe('Inactive');
    expect(statusOf({ saved: true, tested: true, granted: none, enabled: true })).toBe('Active');
  });
});

describe('Settings › External agents', () => {
  it('connects Claude Code or Codex, each with its SVGL icon', () => {
    expect(AGENT_APPS.map((a) => a.name)).toEqual(['Claude Code', 'Codex']);
    for (const a of AGENT_APPS) expect(isBrandIconId(a.brand), a.id).toBe(true);
  });

  it('lets an agent look, edit, or edit and export, and every export still asks you', () => {
    expect(AGENT_LEVELS.map((l) => l.name)).toEqual(['Look only', 'Edit', 'Edit and export']);
    expect(AGENT_LEVELS.at(-1)?.line).toMatch(/still asks you/);
    expect(AGENT_WORDS.revoked).toBe('Revoked. It can’t act any more.');
  });
});

describe('the lead: a video at work', () => {
  it('shows the agent’s level as Read, Edit and Export, the three levels the app has', () => {
    expect([...LEVEL_STEPS]).toEqual(['Read', 'Edit', 'Export']);
    expect(LEVEL_STEPS).toHaveLength(AGENT_LEVELS.length);
  });

  it('asks before an export, and a post goes out through Postiz only once you approve it', () => {
    expect(ASK.detail).toMatch(/still asks you first/);
    expect(ASK.declined).toMatch(/Nothing was exported/);
    expect(POSTIZ_POST.scheduled).toMatch(/^Postiz posts it/);
    // The account is the visitor's own, never a real person's.
    expect(POSTIZ_POST.account).toBe('@yourname');
    // "MCP" is the app's word for the setup; visitors read "other agents" and "tools" everywhere else.
    expect(strings([PLUGINS, AGENT_APPS, AGENT_LEVELS, AGENT_WORDS, ASK, POSTIZ_POST, HINT.title, HINT.hint]).join(' ')).not.toMatch(/\bMCP\b/);
  });
});

describe('the plugins page’s words and files', () => {
  it('hold to the truth ledger', () => {
    const copy = strings([PLUGINS, AGENT_APPS, AGENT_LEVELS, AGENT_WORDS, ASK, POSTIZ_POST, [...LEVEL_STEPS], HINT.title, HINT.hint]);
    expect(copy.length).toBeGreaterThan(60);
    expect(copy.flatMap(claimViolations)).toEqual([]);
    expect(LOOK.area).toBe('make');
  });

  it('keep every lane P file small, licensed and stamped', () => {
    const files = [
      ...filesUnder('src/components/showcase/instagram-edits', ['.ts', '.tsx']),
      ...filesUnder('src/components/showcase/plugins', ['.ts', '.tsx']),
      ...filesUnder('src/components/showcase/product-videos', ['.ts', '.tsx']),
    ];
    expect(files.length).toBeGreaterThan(25);
    for (const file of files) {
      const source = read(file);
      expect(source.split('\n').length, file).toBeLessThanOrEqual(400);
      expect(source.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors\n'), file).toBe(true);
      if (file.endsWith('.tsx') && !file.endsWith('meta.tsx')) expect(source, file).toMatch(/component: .+ · mode: /);
    }
  });
});

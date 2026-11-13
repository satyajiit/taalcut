// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readJson, runScript, STARTS_PROCESSES, withHub, writeRel } from './cli';
import { HUB_ID, template, templateRel } from './fixture';

const AT = '2026-10-14T00:00:00.000Z';
const NOW = '1700000000000';

interface HiddenRow {
  readonly hubId: string;
  readonly reason: string;
  readonly issue: number;
  readonly at: string;
}

const hidden = (root: string) => readJson<HiddenRow[]>(root, 'moderation/hidden.json');

function moderate(root: string, args: string[]): { status: number; stderr: string } {
  return runScript('moderate.mjs', ['--root', root, ...args]);
}

// Its tests build the index as well, which asks git for each template's times.
describe('moderate', STARTS_PROCESSES, () => {
  it('hides once and restores once', () => {
    withHub((root) => {
      const flags = ['--action', 'hide', '--hub-id', HUB_ID, '--reason', 'spam', '--issue', '3', '--at', AT];
      expect(moderate(root, flags).status).toBe(0);
      expect(moderate(root, flags).status).toBe(0);
      expect(hidden(root)).toEqual([{ hubId: HUB_ID, reason: 'spam', issue: 3, at: AT }]);
      const restore = ['--action', 'restore', '--hub-id', HUB_ID];
      expect(moderate(root, restore).status).toBe(0);
      expect(moderate(root, restore).status).toBe(0);
      expect(hidden(root)).toEqual([]);
    });
  });

  it('hides a reported template from the index with one label, and restores it by removing the label', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template()));
      const labeled = join(root, 'labeled.json');
      writeFileSync(
        labeled,
        JSON.stringify({
          action: 'labeled',
          label: { name: 'hidden' },
          issue: {
            number: 9,
            updated_at: '2026-10-14T12:00:00.000Z',
            labels: [{ name: 'report' }, { name: `hub:${HUB_ID}` }, { name: 'hidden' }],
          },
        }),
      );
      const hide = moderate(root, ['--github-event', labeled, '--event-name', 'issues']);
      expect(hide.status, hide.stderr).toBe(0);
      expect(hidden(root)).toEqual([
        { hubId: HUB_ID, reason: 'maintainer', issue: 9, at: '2026-10-14T12:00:00.000Z' },
      ]);
      expect(runScript('build-index.mjs', ['--root', root, '--now', NOW]).status).toBe(0);
      expect(ids(root)).toEqual([]);
      const unlabeled = join(root, 'unlabeled.json');
      writeFileSync(
        unlabeled,
        JSON.stringify({
          action: 'unlabeled',
          label: { name: 'hidden' },
          issue: {
            number: 9,
            updated_at: '2026-10-14T13:00:00.000Z',
            labels: [{ name: 'report' }, { name: `hub:${HUB_ID}` }],
          },
        }),
      );
      const restore = moderate(root, ['--github-event', unlabeled, '--event-name', 'issues']);
      expect(restore.status, restore.stderr).toBe(0);
      expect(hidden(root)).toEqual([]);
      expect(runScript('build-index.mjs', ['--root', root, '--now', NOW]).status).toBe(0);
      expect(ids(root)).toEqual([HUB_ID]);
    });
  });

  it('refuses an issue number that is not a number, and changes nothing', () => {
    withHub((root) => {
      const result = moderate(root, ['--action', 'hide', '--hub-id', HUB_ID, '--issue', '12abc']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('issue');
      expect(hidden(root)).toEqual([]);
    });
  });

  it('hides and restores by hand (the workflow_dispatch path) the same way', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template()));
      expect(runScript('build-index.mjs', ['--root', root, '--now', NOW]).status).toBe(0);
      expect(ids(root)).toEqual([HUB_ID]);
      expect(moderate(root, ['--action', 'hide', '--hub-id', HUB_ID, '--reason', 'spam', '--issue', '4', '--at', AT]).status).toBe(0);
      expect(runScript('build-index.mjs', ['--root', root, '--now', NOW]).status).toBe(0);
      expect(ids(root)).toEqual([]);
      expect(moderate(root, ['--action', 'restore', '--hub-id', HUB_ID]).status).toBe(0);
      expect(runScript('build-index.mjs', ['--root', root, '--now', NOW]).status).toBe(0);
      expect(ids(root)).toEqual([HUB_ID]);
    });
  });
});

function ids(root: string): string[] {
  return readJson<{ templates: { id: string }[] }>(root, 'site/v0/index.json').templates.map((entry) => entry.id);
}

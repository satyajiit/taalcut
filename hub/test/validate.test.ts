// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runScript, withHub, writeRel } from './cli';
import { HUB_ID, template, templateRel } from './fixture';

function validate(root: string, args: string[]): { status: number; stderr: string } {
  return runScript('validate.mjs', ['--root', root, ...args]);
}

describe('validate', () => {
  it('accepts a template at templates/<id[0..2]>/<id>.json', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template()));
      const result = validate(root, ['--files', templateRel()]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  it('rejects a URL, a data URI, an email, an @handle, www and a file path', () => {
    const cases = [
      { description: 'see https://evil.example/x', rule: 'url' },
      { description: 'see data:text/plain,hi', rule: 'dataUri' },
      { description: 'write person@example.com please', rule: 'email' },
      { description: 'hello @ada_lane today', rule: 'handle' },
      { description: 'see www.example.test today', rule: 'www' },
      { description: 'cut from /Users/ada/Movies/trip', rule: 'path' },
    ];
    for (const item of cases) {
      withHub((root) => {
        writeRel(root, templateRel(), JSON.stringify(template({ description: item.description })));
        const result = validate(root, ['--files', templateRel()]);
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain(item.rule);
      });
    }
  });

  it('rejects a URL used as a key, as a schema failure and a url', () => {
    withHub((root) => {
      const doc = template();
      writeRel(root, templateRel(), JSON.stringify({ ...doc, 'https://cdn.example/clip.mp4': 'x' }));
      const result = validate(root, ['--files', templateRel()]);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('https://cdn.example/clip.mp4: schema');
      expect(result.stderr).toContain('https://cdn.example/clip.mp4: url');
    });
  });

  it('rejects contactSheet and frames as schema failures', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify({ ...template(), contactSheet: { columns: 1 } }));
      const sheet = validate(root, ['--files', templateRel()]);
      expect(sheet.status, sheet.stderr).toBe(1);
      expect(sheet.stderr).toContain('contactSheet');
      expect(sheet.stderr).toContain('schema');
    });
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify({ ...template(), frames: [1] }));
      const frames = validate(root, ['--files', templateRel()]);
      expect(frames.status, frames.stderr).toBe(1);
      expect(frames.stderr).toContain('frames');
      expect(frames.stderr).toContain('schema');
    });
  });

  it('rejects PNG bytes renamed to json, a jpg, and a 200 KiB file', () => {
    withHub((root) => {
      writeRel(root, templateRel(), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const png = validate(root, ['--files', templateRel()]);
      expect(png.status, png.stderr).toBe(1);
      expect(png.stderr).toContain('binary');
    });
    withHub((root) => {
      writeRel(root, 'photo.jpg', Buffer.from('not-a-template'));
      const jpg = validate(root, ['--files', 'photo.jpg']);
      expect(jpg.status, jpg.stderr).toBe(1);
      expect(jpg.stderr).toContain('binary');
    });
    withHub((root) => {
      writeRel(root, templateRel(), Buffer.alloc(200 * 1024, 0x20));
      const large = validate(root, ['--files', templateRel()]);
      expect(large.status, large.stderr).toBe(1);
      expect(large.stderr).toContain('tooLarge');
    });
  });

  it('rejects a path that does not match the id, a deletion, and a non-template change', () => {
    withHub((root) => {
      const rel = `templates/ff/${HUB_ID}.json`;
      writeRel(root, rel, JSON.stringify(template()));
      const mismatch = validate(root, ['--files', rel]);
      expect(mismatch.status, mismatch.stderr).toBe(1);
      expect(mismatch.stderr).toContain(': path');
    });
    withHub((root) => {
      const list = join(root, 'changed.txt');
      writeFileSync(list, `${templateRel()}\n`);
      const deleted = validate(root, ['--changed-list', list]);
      expect(deleted.status, deleted.stderr).toBe(1);
      expect(deleted.stderr).toContain(': deleted');
    });
    withHub((root) => {
      const list = join(root, 'changed.txt');
      writeFileSync(list, 'README.md\n');
      const scope = validate(root, ['--changed-list', list]);
      expect(scope.status, scope.stderr).toBe(1);
      expect(scope.stderr).toContain(': scope');
    });
  });

  it('requires the next version to keep the id and the handle', () => {
    withHub((root) => {
      const previous = join(root, 'previous.json');
      writeFileSync(previous, JSON.stringify(template()));
      writeRel(root, templateRel(), JSON.stringify(template({ version: 2 })));
      const ok = validate(root, ['--previous', previous, '--files', templateRel()]);
      expect(ok.status, ok.stderr).toBe(0);
    });
    withHub((root) => {
      const previous = join(root, 'previous.json');
      writeFileSync(previous, JSON.stringify(template()));
      writeRel(root, templateRel(), JSON.stringify(template({ version: 3 })));
      const skipped = validate(root, ['--previous', previous, '--files', templateRel()]);
      expect(skipped.status, skipped.stderr).toBe(1);
      expect(skipped.stderr).toContain(': version');
    });
    withHub((root) => {
      const previous = join(root, 'previous.json');
      writeFileSync(previous, JSON.stringify(template()));
      writeRel(root, templateRel(), JSON.stringify(template({ version: 2, handle: 'bob' })));
      const handle = validate(root, ['--previous', previous, '--files', templateRel()]);
      expect(handle.status, handle.stderr).toBe(1);
      expect(handle.stderr).toContain(': version');
    });
  });
});

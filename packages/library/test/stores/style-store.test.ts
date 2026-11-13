// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V10: the Style store. Revisions conflict, a look lists by the template it was made from, the default is the
 * `styles.default` setting, `usedBy` counts timelines and template versions that name a Style, logos are
 * content-addressed, and a logo no Style names is pruned 7 days after it was let go (so an undo finds it).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STYLE_SETTING, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createSettingsRepository,
  createStyleStore,
  createTemplateStore,
  createTimelineStore,
  styleAssetPath,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { nextVersion, seed, timeline } from './documents';
import { formatTemplate, style } from './style-documents';

const DAY = 24 * 3600_000;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const dir = join(tempDir(), 'styles');
  return { clock, db, dir, styles: createStyleStore(db, { assetsDir: dir }) };
}

describe('style store (P3-V10)', () => {
  it('creates, reads back, replaces only the revision it names, and removes', async () => {
    const { styles } = setup();
    const kit = style();
    expect(unwrap(await styles.create(kit))).toEqual(kit);
    expect(code(await styles.create(kit))).toBe('core.conflict');
    expect(unwrap(await styles.get(kit.id))).toEqual(kit);
    const renamed = { ...kit, name: 'Goa kit v2', revision: 2, updatedAt: kit.updatedAt + 1 };
    expect(code(await styles.put(renamed, 3))).toBe('core.conflict');
    unwrap(await styles.put(renamed, 1));
    expect(unwrap(await styles.get(kit.id))).toMatchObject({ name: 'Goa kit v2', revision: 2 });
    expect(code(await styles.put({ ...kit, name: '' }, 2))).toBe('core.validation');
    unwrap(await styles.remove(kit.id));
    expect(code(await styles.get(kit.id))).toBe('core.not_found');
    expect(code(await styles.remove(kit.id))).toBe('core.not_found');
    expect(code(await styles.usedBy(kit.id))).toBe('core.not_found');
  });

  it("reads a round P3-1 title card's seconds as a duration", async () => {
    const { db, styles } = setup();
    const kit = style();
    unwrap(await styles.create(kit));
    const stored = { ...kit, intro: { kind: 'card', text: 'Goa', seconds: 2, background: 'primary' } };
    db.driver.prepare('UPDATE styles SET document = ? WHERE id = ?').run(JSON.stringify(stored), kit.id);
    expect(unwrap(await styles.get(kit.id)).intro).toEqual({
      kind: 'card',
      text: 'Goa',
      background: 'primary',
      duration: { value: 2000, rate: { num: 1000, den: 1 } },
    });
  });

  it('lists newest first, filters looks by the template they were made from, and marks the default', async () => {
    const { db, styles } = setup();
    const templateId = newId<'Template'>();
    const kit = style({ name: 'Kit', updatedAt: 3 });
    const lookV1 = style({ name: 'Look 1', updatedAt: 2, madeFrom: { templateId, version: 1 } });
    const lookV2 = style({ name: 'Look 2', updatedAt: 1, madeFrom: { templateId, version: 2 } });
    for (const s of [lookV2, kit, lookV1]) unwrap(await styles.create(s));
    unwrap(createSettingsRepository(db).set(DEFAULT_STYLE_SETTING.key, kit.id));
    const all = unwrap(await styles.list());
    expect(all.map((s) => [s.name, s.isDefault])).toEqual([
      ['Kit', true],
      ['Look 1', false],
      ['Look 2', false],
    ]);
    expect(all[1]).toMatchObject({ kind: 'look', revision: 1, logo: null, colours: kit.colours });
    const names = async (madeFrom: { templateId: typeof templateId; version?: number }) =>
      unwrap(await styles.list({ madeFrom })).map((s) => s.name);
    expect(await names({ templateId })).toEqual(['Look 1', 'Look 2']);
    expect(await names({ templateId, version: 2 })).toEqual(['Look 2']);
    expect(await names({ templateId: newId<'Template'>() })).toEqual([]);
  });

  it('counts the timelines and template versions that name a Style', async () => {
    const { db, styles } = setup();
    const templates = createTemplateStore(db, { assetsDir: join(tempDir(), 'templates') });
    const timelines = createTimelineStore(db);
    const kit = style();
    unwrap(await styles.create(kit));
    const plan = formatTemplate({ styleId: kit.id });
    unwrap(await templates.create(plan, { name: 'Vlog', projectId: null, listed: true }));
    const change = { command: 'template.setStyle', source: 'ui' as const, changeKey: 'k'.repeat(64) };
    unwrap(await templates.addVersion(nextVersion(plan, 2, 1), change));
    const { project, assets } = seed(db);
    const named = { ...timeline(project.id, assets), styleId: kit.id };
    unwrap(await timelines.create(named));
    unwrap(await timelines.create(timeline(project.id, assets)));
    expect(unwrap(await styles.usedBy(kit.id))).toEqual({ timelines: 1, templates: 2 });
    unwrap(await timelines.put({ ...named, styleId: null }, named.revision));
    expect(unwrap(await styles.usedBy(kit.id))).toEqual({ timelines: 0, templates: 2 });
  });

  it('keeps logos by content and prunes one no Style has named for 7 days', async () => {
    const { clock, dir, styles } = setup();
    const png = new TextEncoder().encode('png bytes');
    const put = unwrap(await styles.putAsset(png, 'image/png'));
    expect(unwrap(await styles.putAsset(png, 'image/png'))).toEqual(put);
    expect(unwrap(await styles.assetPath(put.sha256))).toBe(styleAssetPath(dir, put.sha256));
    expect(code(await styles.putAsset(new Uint8Array(), 'image/png'))).toBe('core.validation');
    expect(code(await styles.putAsset(new Uint8Array(6 * 1024 * 1024), 'image/png'))).toBe('core.validation');
    expect(code(await styles.assetPath('../../etc/passwd'))).toBe('core.validation');

    const kit = style({ logo: put.sha256 });
    unwrap(await styles.create(kit));
    const next = unwrap(await styles.putAsset(new TextEncoder().encode('new logo'), 'image/webp'));
    const stray = unwrap(await styles.putAsset(new TextEncoder().encode('never used'), 'image/jpeg'));
    clock.advance(10 * DAY);
    // The first logo is named, the second was just put back (its 7 days start over), the stray goes.
    unwrap(await styles.putAsset(new TextEncoder().encode('new logo'), 'image/webp'));
    expect(unwrap(styles.pruneAssets())).toBe(1);
    expect(code(await styles.assetPath(stray.sha256))).toBe('core.not_found');

    const logo = kit.logo && { ...kit.logo, asset: next.sha256, mediaType: 'image/webp' as const };
    const swapped = { ...kit, logo, revision: 2 };
    unwrap(await styles.put(swapped, 1));
    clock.advance(6 * DAY);
    expect(unwrap(styles.pruneAssets())).toBe(0); // released 6 days ago: an undo still finds it
    clock.advance(2 * DAY);
    expect(unwrap(styles.pruneAssets())).toBe(1);
    expect(code(await styles.assetPath(put.sha256))).toBe('core.not_found');
    expect(existsSync(styleAssetPath(dir, next.sha256))).toBe(true);
    unwrap(await styles.remove(kit.id));
    clock.advance(8 * DAY);
    expect(unwrap(styles.pruneAssets())).toBe(1);
  });
});

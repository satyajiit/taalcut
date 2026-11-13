// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates package's persistence port (memory stores), not the library lane's SQLite.
 * A brand kit and the template that names it survive a JSON snapshot and a new store.
 */
import { describe, expect, it } from 'vitest';
import { createMemorySettingsStore, newId, ok, STYLE_COMMANDS, type StyleInput } from '@taalcut/core';
import { createStyleCommands } from '../../src/styles/style-commands';
import { createStyleService } from '../../src/styles/style-service';
import { createSetStyleCommand } from '../../src/styles/template-set-style';
import { asTemplate, type MemoryTemplateSnapshot } from '../../src/testing/memory-template-record';
import { createMemoryStyleStore, type MemoryStyleSnapshot } from '../../src/testing/memory-style-store';
import { createMemoryTemplateStore } from '../../src/testing/memory-template-store';
import { requirePlan } from '../formats/helpers';
import { setupTemplates, UI } from '../helpers/setup';

const font = { family: 'notoSans' as const, weight: 400 as const };

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}

function isStyleSnapshot(value: unknown): value is MemoryStyleSnapshot {
  return (
    typeof value === 'object' && value !== null && 'styles' in value && 'assets' in value && 'usage' in value
  );
}

function isTemplateSnapshot(value: unknown): value is MemoryTemplateSnapshot {
  return typeof value === 'object' && value !== null && 'lineages' in value && 'assets' in value;
}

function reopen<T>(value: unknown, guard: (item: unknown) => item is T): T {
  const raw: unknown = JSON.parse(JSON.stringify(value));
  if (!guard(raw)) throw new Error('snapshot did not survive JSON');
  return raw;
}

describe('package memory persistence port (not library SQL)', () => {
  it('reopens a brand kit with its logo bytes and the template head that names it', async () => {
    const setup = setupTemplates();
    const styles = createMemoryStyleStore();
    setup.bus.register(
      ...createStyleCommands({ store: styles, settings: createMemorySettingsStore(), clock: setup.clock })
        .all,
      createSetStyleCommand({ service: setup.service, styles }),
    );
    const bytes = png(16, 16);
    const imported = await createStyleService({
      store: styles,
      readFile: async () => ok(bytes),
    }).importImage('logo.png');
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const styleId = newId<'Style'>();
    const style: StyleInput = {
      name: 'Brand',
      kind: 'brandKit',
      colours: {
        primary: '#112233',
        secondary: '#445566',
        accent: '#778899',
        text: '#111111',
        background: '#ffffff',
      },
      fonts: { heading: font, body: font },
      captions: null,
      textStyles: {},
      logo: {
        asset: imported.value.sha256,
        mediaType: imported.value.mediaType,
        width: imported.value.width,
        height: imported.value.height,
        placement: 'topRight',
        scale: 0.2,
        opacity: 0.8,
        showOn: 'always',
      },
      watermark: null,
      intro: null,
      outro: null,
      grade: null,
      fontMatch: null,
      madeFrom: null,
    };
    const created = await setup.bus.dispatch(STYLE_COMMANDS.create, { projectId: null, styleId, style }, UI);
    expect(created.ok).toBe(true);
    const template = requirePlan('vlog', 30);
    const stored = await setup.bus.dispatch(
      'template.create',
      { projectId: setup.projectA, template, name: 'Vlog', listed: true },
      UI,
    );
    expect(stored.ok).toBe(true);
    const applied = await setup.bus.dispatch(
      'template.setStyle',
      { projectId: setup.projectA, templateId: template.id, baseVersion: 1, styleId },
      UI,
    );
    expect(applied.ok).toBe(true);

    const reopenedStyles = createMemoryStyleStore(reopen(styles.snapshot(), isStyleSnapshot));
    const reopenedTemplates = createMemoryTemplateStore(
      setup.clock,
      reopen(setup.store.snapshot(), isTemplateSnapshot),
    );
    const head = await reopenedTemplates.get(template.id);
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.value.summary.styleId).toBe(styleId);
    expect(asTemplate(head.value.json).styleId).toBe(styleId);
    expect(Array.from(reopenedStyles.assetBytes(imported.value.sha256) ?? [])).toEqual(Array.from(bytes));
    const kit = await reopenedStyles.get(styleId);
    expect(kit.ok && kit.value.logo?.asset).toBe(imported.value.sha256);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Style commands and template.setStyle on core's bus (P3-V10). */
import { describe, expect, it } from 'vitest';
import {
  createMemorySettingsStore,
  DEFAULT_STYLE_SETTING,
  FORMAT_IDS,
  newId,
  STYLE_COMMANDS,
  type StyleInput,
} from '@taalcut/core';
import { applyStylePatch } from '../../src/styles/style-patch';
import { createStyleCommands } from '../../src/styles/style-commands';
import { createSetStyleCommand } from '../../src/styles/template-set-style';
import { createMemoryStyleStore } from '../../src/testing/memory-style-store';
import { requirePlan } from '../formats/helpers';
import { setupTemplates, UI } from '../helpers/setup';

const font = { family: 'notoSans' as const, weight: 400 as const };

function brand(name = 'Kit'): StyleInput {
  return {
    name,
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
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
  };
}

function stylesOf() {
  const setup = setupTemplates();
  const styles = createMemoryStyleStore();
  const settings = createMemorySettingsStore();
  const commands = createStyleCommands({ store: styles, settings, clock: setup.clock });
  setup.bus.register(...commands.all, createSetStyleCommand({ service: setup.service, styles }));
  return { ...setup, styles, settings };
}

describe('style commands', () => {
  it('creates, updates, renames and setDefault, and each undoes and redoes', async () => {
    const { bus, styles, settings } = stylesOf();
    const styleId = newId<'Style'>();
    const created = await bus.dispatch(
      STYLE_COMMANDS.create,
      { projectId: null, styleId, style: brand() },
      UI,
    );
    expect(created.ok && created.value.result).toEqual({ styleId, revision: 1 });

    const updated = await bus.dispatch(
      STYLE_COMMANDS.update,
      { projectId: null, styleId, baseRevision: 1, patch: { name: 'Trip kit' } },
      UI,
    );
    expect(updated.ok && updated.value.result).toEqual({ styleId, revision: 2 });
    const stale = await bus.dispatch(
      STYLE_COMMANDS.update,
      { projectId: null, styleId, baseRevision: 1, patch: { name: 'Stale' } },
      UI,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('core.conflict');

    expect((await bus.undo(null, UI)).ok).toBe(true);
    const undoneUpdate = await styles.get(styleId);
    expect(undoneUpdate.ok ? undoneUpdate.value.name : null).toBe('Kit');
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const redoneUpdate = await styles.get(styleId);
    expect(redoneUpdate.ok ? redoneUpdate.value.name : null).toBe('Trip kit');

    const renamed = await bus.dispatch(
      STYLE_COMMANDS.rename,
      { projectId: null, styleId, name: 'Holiday' },
      UI,
    );
    expect(renamed.ok && renamed.value.result).toEqual({ styleId, name: 'Holiday' });
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const undoneRename = await styles.get(styleId);
    expect(undoneRename.ok ? undoneRename.value.name : null).toBe('Trip kit');
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const redoneRename = await styles.get(styleId);
    expect(redoneRename.ok ? redoneRename.value.name : null).toBe('Holiday');

    const chosen = await bus.dispatch(STYLE_COMMANDS.setDefault, { projectId: null, styleId }, UI);
    expect(chosen.ok).toBe(true);
    const chosenSetting = await settings.get(DEFAULT_STYLE_SETTING);
    expect(chosenSetting.ok ? chosenSetting.value : undefined).toBe(styleId);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const clearedSetting = await settings.get(DEFAULT_STYLE_SETTING);
    expect(clearedSetting.ok ? clearedSetting.value : undefined).toBeNull();
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const restoredSetting = await settings.get(DEFAULT_STYLE_SETTING);
    expect(restoredSetting.ok ? restoredSetting.value : undefined).toBe(styleId);

    expect((await bus.undo(null, UI)).ok).toBe(true);
    const removed = await bus.dispatch(STYLE_COMMANDS.remove, { projectId: null, styleId }, UI);
    expect(removed.ok).toBe(true);
    expect((await styles.get(styleId)).ok).toBe(false);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const restored = await styles.get(styleId);
    expect(restored.ok ? restored.value.name : null).toBe('Holiday');
    expect((await bus.redo(null, UI)).ok).toBe(true);
    expect((await styles.get(styleId)).ok).toBe(false);
  });

  it('refuses to delete a style a timeline or template still uses', async () => {
    const { bus, styles } = stylesOf();
    const styleId = newId<'Style'>();
    await bus.dispatch(STYLE_COMMANDS.create, { projectId: null, styleId, style: brand() }, UI);
    styles.setUsage(styleId, { timelines: 2, templates: 1 });
    const refused = await bus.dispatch(STYLE_COMMANDS.remove, { projectId: null, styleId }, UI);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('templates.style_in_use');
      expect(refused.error.params).toEqual({ timelines: 2, templates: 1 });
    }
    expect((await styles.get(styleId)).ok).toBe(true);
    const missing = await bus.dispatch(
      STYLE_COMMANDS.remove,
      { projectId: null, styleId: newId<'Style'>() },
      UI,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('templates.style_not_found');
  });

  it('rejects a logo watermark with no logo', () => {
    const styleId = newId<'Style'>();
    const parsed = {
      schemaVersion: 1 as const,
      id: styleId,
      revision: 1,
      ...brand(),
      createdAt: 1,
      updatedAt: 1,
    };
    const patched = applyStylePatch(parsed, {
      watermark: { kind: 'logo', placement: 'topLeft', opacity: 0.4 },
    });
    expect(patched.ok).toBe(false);
    if (!patched.ok) expect(patched.error.detail).toBe('watermark.logoMissing');
  });

  it('template.setStyle makes one version per format plan and one undo restores the head', async () => {
    const { bus, service, projectA } = stylesOf();
    const styleId = newId<'Style'>();
    await bus.dispatch(STYLE_COMMANDS.create, { projectId: null, styleId, style: brand('Brand') }, UI);
    for (const formatId of FORMAT_IDS) {
      const template = requirePlan(formatId, 30);
      const stored = await bus.dispatch(
        'template.create',
        { projectId: projectA, template, name: formatId, listed: true },
        UI,
      );
      expect(stored.ok).toBe(true);
      const edited = await bus.dispatch(
        'template.setStyle',
        { projectId: projectA, templateId: template.id, baseVersion: 1, styleId },
        UI,
      );
      expect(edited.ok && edited.value.result).toEqual({ templateId: template.id, version: 2 });
      const head = await service.get({ templateId: template.id });
      expect(head.ok && head.value.template.styleId).toBe(styleId);
      expect((await bus.undo(projectA, UI)).ok).toBe(true);
      const back = await service.get({ templateId: template.id });
      expect(back.ok && back.value.template.version).toBe(1);
      expect(back.ok && back.value.template.styleId).toBeNull();
      expect((await bus.redo(projectA, UI)).ok).toBe(true);
      const again = await service.get({ templateId: template.id });
      expect(again.ok && again.value.template.version).toBe(2);
      const versions = await service.versions(template.id);
      expect(versions.ok && versions.value).toHaveLength(2);
      expect((await bus.undo(projectA, UI)).ok).toBe(true);
    }
  });
});

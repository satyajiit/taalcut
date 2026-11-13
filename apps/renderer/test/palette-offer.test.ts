// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-FIX: ⌘K runs a bus command as is (an empty payload) only when the bus says it needs none
 * (CommandInfo.needsPayload); one that needs a payload is offered only through an item that supplies it.
 */
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { INTERNAL_COMMANDS, paletteOffer } from '../src/features/palette/internal-commands';

describe('paletteOffer', () => {
  it('runs a command that needs no payload as is', () => {
    expect(paletteOffer({ name: 'components.download' }, false)).toBe('asIs');
  });

  it('leaves a command that needs a payload to its page, unless an item of its own supplies one', () => {
    expect(paletteOffer({ name: 'memory.create', needsPayload: true }, false)).toBe('hidden');
    expect(paletteOffer({ name: 'models.setModuleOverride', needsPayload: true }, true)).toBe('ownItem');
  });

  it('never offers an internal command or one ⌘K leaves out by name, even with an item of its own', () => {
    expect(paletteOffer({ name: 'models.restore', internal: true }, true)).toBe('hidden');
    expect(paletteOffer({ name: 'go.projects' }, true)).toBe('hidden');
  });

  it('names only commands the bus would offer: each accepts {} on the bus', () => {
    const { controls } = createFakeBackend();
    const listed = new Map(controls.bus.list().map((info) => [info.name, info]));
    for (const name of INTERNAL_COMMANDS) {
      expect(listed.has(name), `${name} is on the bus`).toBe(true);
      expect(
        listed.get(name)?.needsPayload,
        `${name} needs a payload: the bus hides it already`,
      ).toBeUndefined();
    }
  });

  it('hides every command on the bus that needs a payload and has no item of its own', () => {
    const { controls } = createFakeBackend();
    const offered = controls.bus.list().filter((info) => paletteOffer(info, false) === 'asIs');
    expect(offered.filter((info) => info.needsPayload)).toEqual([]);
    expect(offered.map((info) => info.name)).toContain('instagramSaved.syncCollection');
    expect(offered.map((info) => info.name)).not.toContain('instagramSaved.setWatch');
  });
});

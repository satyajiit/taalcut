// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { feature } from '#content/features';
import { SAMPLE_ROLL } from '#components/showcase/auto-pick/roll';
import { IMPORT_ROWS } from '#components/showcase/import/entry';
import { HINT, LOOK } from '#components/showcase/import/meta';
import {
  ASK_FOR,
  FIRST_CLIPS,
  FIRST_SEND,
  firstArrivals,
  GROUPS,
  groupsOn,
  listWords,
  MAC_ONLY,
  MORE_CLIPS,
  nextClips,
  phoneWords,
  RUN_END,
  settledAt,
  STAGE_AT,
  stageAt,
  STAGES,
  WAYS,
  wayOn,
  type WayId,
} from '#components/showcase/import/ways';
import { REPO_ROOT } from './source-files';

const appWords = readFileSync(join(REPO_ROOT, 'apps/renderer/src/features/library/imports/import-words.ts'), 'utf8');
const chooser = readFileSync(join(REPO_ROOT, 'apps/renderer/src/features/library/imports/import-chooser.tsx'), 'utf8');
const phone = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/transfer/phone/locales/en.json'), 'utf8')) as Record<string, string>;

/** One entry of a `Record<…, MessageDescriptor>` in import-words.ts: `key: msg\`words\``. */
function appMessage(record: string, key: string): string | undefined {
  const block = new RegExp(`export const ${record}[^{]*\\{([\\s\\S]*?)\\n\\};`).exec(appWords)?.[1] ?? '';
  const quoted = key.includes('-') ? `'${key}'` : key;
  return new RegExp(`\\s${quoted.replace(/[-']/g, '\\$&')}: msg\`([^\`]*)\``).exec(block)?.[1];
}

describe('Library › Import in the app’s words', () => {
  it('names every way in and its note exactly as the app does', () => {
    for (const way of Object.values(WAYS)) {
      expect(appMessage('METHOD_NAMES', way.id), way.id).toBe(way.name);
      expect(appMessage('METHOD_NOTES', way.id), way.id).toBe(way.note);
    }
  });

  it('keeps the chooser’s three groups, in its order', () => {
    expect(GROUPS.map((g) => g.title)).toEqual(['This computer', 'Phones', 'Cameras and cards']);
    for (const group of GROUPS) {
      const list = group.ways.map((w) => `'${w}'`).join(', ');
      expect(chooser, group.title).toContain(`[${list}]`);
    }
    expect(GROUPS.flatMap((g) => g.ways).sort()).toEqual(Object.keys(WAYS).sort());
  });

  it('says the stages as the app does, in order', () => {
    const keys = ['receiving', 'checking', 'available', 'searchable', 'analysed'];
    expect(STAGES.map(String)).toEqual(keys.map((k) => appMessage('STAGE_NAMES', k)));
  });

  it('says the phone’s states as the phone page does', () => {
    expect(phoneWords(0)).toBe(phone['state.sending']);
    expect(phoneWords(1)).toBe(phone['state.adding']);
    expect(phoneWords(2)).toBe(phone['state.added']);
    expect(phoneWords(4)).toBe(phone['state.added']);
    for (const key of ['approval.waiting', 'approval.match', 'approval.denied', 'approval.again', 'choose.title', 'pick.files', 'pick.filesNote', 'pick.photos', 'pick.photosNote']) {
      expect(phone[key], key).toBeTruthy();
    }
  });
});

describe('the platforms (the WEB3 truth ledger)', () => {
  it('offers Files, Folder and Phone over Wi-Fi on Ubuntu, and every way on a Mac', () => {
    expect(groupsOn('ubuntu').flatMap((g) => g.ways)).toEqual(['files', 'folder', 'phone-wifi']);
    expect(groupsOn('ubuntu').map((g) => g.title)).toEqual(['This computer', 'Phones']);
    expect(groupsOn('mac').flatMap((g) => g.ways)).toHaveLength(8);
    expect(MAC_ONLY).toEqual(['photos', 'phone-cable', 'camera', 'dji', 'insta360']);
    expect(listWords(MAC_ONLY)).toBe('Apple Photos, Phone on a cable, Camera or card, DJI and Insta360');
  });

  it('falls back to Phone over Wi-Fi when the chosen way isn’t on Ubuntu', () => {
    for (const id of Object.keys(WAYS) as WayId[]) {
      expect(wayOn('mac', id)).toBe(id);
      expect(wayOn('ubuntu', id)).toBe(WAYS[id].macOnly ? 'phone-wifi' : id);
    }
  });
});

describe('Phone over Wi-Fi’s run', () => {
  it('moves a clip through the stages in order, from the moment it is sent', () => {
    expect(stageAt(-1)).toBe(-1);
    expect(stageAt(0)).toBe(0);
    expect(STAGE_AT).toHaveLength(STAGES.length);
    expect([...STAGE_AT]).toEqual([...STAGE_AT].sort((a, b) => a - b));
    for (const [i, at] of STAGE_AT.entries()) expect(stageAt(at)).toBe(i);
    expect(stageAt(1e6)).toBe(STAGES.length - 1);
  });

  it('allows the phone, then rests under five seconds with each clip at its own stage', () => {
    expect(ASK_FOR).toBeLessThan(FIRST_SEND);
    expect(RUN_END).toBeLessThan(5000);
    const stages = firstArrivals().map((a) => stageAt(RUN_END - a.sentAt));
    expect(stages).toEqual([4, 4, 3, 2]);
    // Every clip is ready to edit at rest, and not all are fully analysed yet.
    expect(stages.every((s) => s >= 2)).toBe(true);
    expect(settledAt(firstArrivals())).toBeGreaterThan(RUN_END);
  });

  it('sends the owner’s own clips, each once, two to a choice', () => {
    const roll = new Set(SAMPLE_ROLL.map((c) => c.id));
    const all = [...FIRST_CLIPS, ...MORE_CLIPS];
    expect(all.every((id) => roll.has(id))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((id) => id.startsWith('airport-'))).toBe(true);
    expect(all.some((id) => id.startsWith('vietnam-'))).toBe(true);
    expect(all.some((id) => id.startsWith('repeat-'))).toBe(true);
    let sent = firstArrivals();
    let rounds = 0;
    while (nextClips(sent).length > 0) {
      const next = nextClips(sent);
      expect(next.length).toBeLessThanOrEqual(2);
      sent = [...sent, ...next.map((clipId, i) => ({ clipId, sentAt: RUN_END + i, from: 'files' as const }))];
      rounds += 1;
    }
    expect(rounds).toBe(MORE_CLIPS.length / 2);
    expect(sent).toHaveLength(all.length);
  });
});

describe('the page’s parts', () => {
  it('give each fact its icon and scene, in order', () => {
    expect(IMPORT_ROWS).toHaveLength(feature('import').facts.length);
    for (const row of IMPORT_ROWS) expect(typeof row.Scene).toBe('function');
  });

  it('look the part: teal for yours, the library, Kaatu filming', () => {
    expect(LOOK).toMatchObject({ job: 'you', area: 'library', pose: 'film' });
    expect(LOOK.stickers).toHaveLength(3);
  });

  it('hold to the truth ledger', () => {
    const words = [
      ...Object.values(WAYS).flatMap((w) => [w.name, w.note]),
      ...GROUPS.map((g) => g.title),
      ...STAGES,
      HINT.title,
      String(HINT.hint),
    ];
    expect(words.flatMap(claimViolations)).toEqual([]);
    // Encryption never; Ubuntu never with a cable, a camera or Apple Photos.
    expect(words.join(' ')).not.toMatch(/encrypt/i);
  });
});

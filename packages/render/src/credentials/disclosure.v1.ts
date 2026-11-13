// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-platform AI disclosure reminders (SPEC P3.3), versioned data. Shown on the export dialog and the finished
 * render whenever the export has a generated part, credentials on or off: a manifest is technical, each
 * platform's label is a toggle in its own app, and Taalcut can't set it (no direct publishing in v1). The UI
 * lane writes the copy under the i18n keys; `defaultText` is the English the catalogue starts from.
 *
 * Read from each platform's help page on `checkedOn` (research c2pa.md, section 8). None of the pages shows a
 * date: re-read them on the day the strings freeze and bump `version` when a step changes.
 */
import type { Platform } from '@taalcut/core';
import type { AiInventory } from './ai-inventory';

export interface DisclosureReminder {
  readonly platform: Platform;
  /** 'render.disclosure.<platform>.title' and '.steps'. */
  readonly titleKey: string;
  readonly stepsKey: string;
  readonly source: string;
  readonly defaultText: { readonly title: string; readonly steps: string };
}

export interface DisclosureData {
  readonly version: number;
  readonly checkedOn: string;
  readonly reminders: readonly DisclosureReminder[];
}

const reminder = (
  platform: Platform,
  source: string,
  defaultText: DisclosureReminder['defaultText'],
): DisclosureReminder => ({
  platform,
  titleKey: `render.disclosure.${platform}.title`,
  stepsKey: `render.disclosure.${platform}.steps`,
  source,
  defaultText,
});

export const DISCLOSURE_V1: DisclosureData = {
  version: 1,
  checkedOn: '2026-10-14',
  reminders: [
    reminder('shorts', 'https://support.google.com/youtube/answer/14328491', {
      title: 'YouTube Shorts',
      steps:
        'In YouTube Studio, set "Altered or synthetic content" (AI use) to Yes when the video shows a realistic person, place or event that AI made or changed, or AI music is the focus. With Content Credentials on, YouTube may label it automatically, and that label can\'t be changed.',
    }),
    reminder('reels', 'https://www.facebook.com/help/7434563519957988', {
      title: 'Instagram and Facebook Reels',
      steps:
        'Use "Add AI label" when realistic video or audio was made or changed with AI (an AI voiceover counts). Credentials that say "created with AI" add the label for you.',
    }),
    reminder('tiktok', 'https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content', {
      title: 'TikTok',
      steps:
        'Turn on "AI-generated content" under More options for realistic AI images, audio or video. With Content Credentials on, TikTok adds its own label, which can\'t be removed.',
    }),
  ],
};

/** The platforms to remind about: all of them whenever a model made any part of the export, else none. */
export function disclosuresFor(inventory: AiInventory, data: DisclosureData = DISCLOSURE_V1): Platform[] {
  return inventory.generated.length > 0 ? data.reminders.map((entry) => entry.platform) : [];
}

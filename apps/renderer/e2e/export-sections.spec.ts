// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The export dialog's Phase 3 sections (P3-V5, P3-V7, P3-V2, P3-V6, P3-B6, P3-V18), as steps since UX4: with a
// timeline as Phase 3 leaves it (a voiceover, hits, reframed clips, generated music, a Pexels clip and a CC BY
// effect), every section shows on its step, in order, and each section's control dispatches its command; Content
// Credentials stay off until a person turns them on, with the reminders; pro export (folded under the first step)
// writes a file, lists what won't come through and saves a copy; Copy puts the credits on the clipboard. Axe in
// light and dark on the steps and the summary, the keyboard path through every step (each heading takes focus),
// and the pseudo-locale on every step.
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible, settle } from './axe.ts';
import { backend } from './backend-driver.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';

// The YouTube Shorts radio, not its AV1 sibling ("YouTube Shorts (AV1)"): a radio's name runs on into its limit
// and size, so it is matched from the start and stops short of the AV1 one.
const SHORTS = /^YouTube Shorts(?! \(AV1\))/;
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
const TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB';
const EDITOR = { name: 'editor', path: `/projects/${PROJECT}/timeline?timeline=${TIMELINE}` };
const STEPS = ['destination', 'sound', 'captions', 'framing', 'credits', 'summary'];
/** Each step's sections; "For another editor" is folded under the first step's choice (there, but hidden). */
const SECTIONS: Readonly<Record<string, readonly string[]>> = {
  destination: ['where', 'otherEditors'],
  sound: ['music', 'voice'],
  captions: ['captions'],
  framing: ['reframe'],
  credits: ['aiLabel', 'credits'],
  summary: [],
};
const SHOTS = process.env.TAALCUT_EXPORT_SCREENS ?? new URL('screenshots/export/', ARTIFACTS).pathname;

const ran = async (page: Page, prefix: string) =>
  (await backend.dispatched(page)).filter((entry) => entry.name.startsWith(prefix));

/** The editor with the timeline as Phase 3 leaves it, then "Export…". */
async function openExport(page: Page): Promise<Locator> {
  await open(page, EDITOR);
  // window.taalcutFake.make.p3.interchange.showcase (src/backend/fake/make/p3/interchange/showcase.ts).
  const seeded = await page.evaluate(
    ([projectId, timelineId]) => {
      let node: unknown = Reflect.get(window, 'taalcutFake');
      for (const key of ['make', 'p3', 'interchange'])
        node = typeof node === 'object' && node !== null ? Reflect.get(node, key) : undefined;
      const showcase: unknown =
        typeof node === 'object' && node !== null ? Reflect.get(node, 'showcase') : undefined;
      return typeof showcase === 'function' && showcase.call(node, projectId, timelineId) === true;
    },
    [PROJECT, TIMELINE] as const,
  );
  expect(seeded).toBe(true);
  await page.locator('[data-slot=export]').click();
  const dialog = page.getByRole('dialog');
  await expect(current(dialog, 'destination')).toBeVisible();
  return dialog;
}

/** The step on screen (while steps crossfade, the one leaving is another step and inert). */
const current = (dialog: Locator, step: string) =>
  dialog.locator(`[data-slot=export-step][data-step=${step}]`);

/** Straight to a step from the stepper, then its heading has focus. */
async function toStep(dialog: Locator, step: string) {
  await dialog.locator(`[data-slot=export-stepper] button[data-step=${step}]`).click();
  await expect(current(dialog, step).getByRole('heading', { level: 3 })).toBeFocused();
}

/** Next, then the next step's heading has focus. */
async function next(dialog: Locator, step: string) {
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(current(dialog, step).getByRole('heading', { level: 3 })).toBeFocused();
}

async function openOtherEditors(dialog: Locator) {
  const fold = dialog.locator('[data-slot=export-other-editors] > button');
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(dialog.locator('[data-slot=export-other-editors] [data-slot=collapse]')).toHaveAttribute(
    'data-state',
    'open',
  );
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS.replace(/\/?$/, '/')}${name}.png` });
}

test.describe('export dialog sections (Phase 3)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeChat(page, { latencyMs: 20, renderTickMs: 0 });
  });

  test('every step, in order, its sections, each control dispatching its command', async ({ page }) => {
    const dialog = await openExport(page);
    expect(
      await dialog
        .locator('[data-slot=export-stepper] button[data-step]')
        .evaluateAll((all) => all.map((n) => n.getAttribute('data-step'))),
    ).toEqual(STEPS);
    await expect(
      dialog.getByRole('navigation', { name: 'Export steps' }).locator('[aria-current=step]'),
    ).toHaveAttribute('data-step', 'destination');
    const sections = (step: string) =>
      current(dialog, step)
        .locator('[data-section]')
        .evaluateAll((all) => all.map((n) => n.getAttribute('data-section')));
    expect(await sections('destination')).toEqual(SECTIONS.destination);
    await dialog.getByRole('radio', { name: SHORTS }).click();
    await expect.poll(() => ran(page, 'render.setExportPreset')).toHaveLength(1);
    // "For another editor" waits under the fold.
    await expect(dialog.locator('[data-slot=export-other-editors] [data-slot=collapse]')).toHaveAttribute(
      'data-state',
      'closed',
    );
    await expect(dialog.getByRole('button', { name: 'Write the file' })).toHaveCount(0);
    await openOtherEditors(dialog);

    await next(dialog, 'sound');
    expect(await sections('sound')).toEqual(SECTIONS.sound);
    await dialog.getByRole('switch', { name: 'Lower the music under the voice' }).click();
    await expect
      .poll(() => ran(page, 'music.setDucking'))
      .toEqual([{ name: 'music.setDucking', source: 'ui' }]);
    await dialog.getByRole('switch', { name: 'Hits on the cuts' }).click();
    await expect.poll(() => ran(page, 'sfx.setHits')).toEqual([{ name: 'sfx.setHits', source: 'ui' }]);
    await expect(dialog.getByText('Taken out. Turn it back on to put them back.')).toBeVisible();
    await dialog.getByRole('switch', { name: 'Voiceover in the video' }).click();
    await expect
      .poll(() => ran(page, 'voice.removeVoiceover'))
      .toEqual([{ name: 'voice.removeVoiceover', source: 'ui' }]);

    await next(dialog, 'captions');
    expect(await sections('captions')).toEqual(SECTIONS.captions);
    await dialog.getByRole('switch', { name: 'Also save a subtitle file (.srt)' }).click();

    await next(dialog, 'framing');
    expect(await sections('framing')).toEqual(SECTIONS.framing);
    await dialog.getByRole('switch', { name: 'Smart reframe' }).click();
    await expect.poll(async () => (await ran(page, 'timeline.setReframe')).length).toBe(3);

    await next(dialog, 'credits');
    expect(await sections('credits')).toEqual(SECTIONS.credits);

    // The summary: one line a step, each with its Change; Back goes one step back.
    await next(dialog, 'summary');
    const summary = dialog.locator('[data-slot=export-summary]');
    await expect(summary).toContainText('YouTube Shorts');
    await expect(summary).toContainText('a subtitle file (.srt) beside it');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(current(dialog, 'credits').getByRole('heading', { level: 3 })).toBeFocused();
    await toStep(dialog, 'summary');
    await summary.getByRole('button', { name: 'Change Captions' }).click();
    await expect(current(dialog, 'captions').getByRole('heading', { level: 3 })).toBeFocused();
    await toStep(dialog, 'summary');
    expect(await ran(page, 'render.export')).toEqual([]);
    await dialog.getByRole('button', { name: /^Export for YouTube Shorts/ }).click();
    await expect.poll(() => ran(page, 'render.export')).toEqual([{ name: 'render.export', source: 'ui' }]);
  });

  test('Content Credentials: off by default, the reminders either way; on is a person’s choice', async ({
    page,
  }) => {
    const dialog = await openExport(page);
    await toStep(dialog, 'credits');
    const toggle = dialog.getByRole('switch', { name: 'Add Content Credentials (C2PA)' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByText(/1 part carries Content Credentials from its maker/)).toBeVisible();
    const reminders = dialog.locator('[data-slot=disclosures] li');
    await expect(reminders).toHaveCount(3);
    // This export is for Reels, so its reminder is the one open.
    await expect(reminders.nth(1).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    await expect(reminders.nth(0).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText(/Signed with a test certificate/)).toBeVisible();
    await expect(reminders).toHaveCount(3);
    expect(await ran(page, 'render.setContentCredentials')).toEqual([
      { name: 'render.setContentCredentials', source: 'ui' },
    ]);
    await shot(page, 'credentials-on-light');
  });

  test('pro export writes the file, lists what won’t come through, and saves a copy; credits Copy', async ({
    page,
  }) => {
    const dialog = await openExport(page);
    await openOtherEditors(dialog);
    const otio = dialog.locator('[data-format=otio]');
    await otio.getByRole('button', { name: 'Write the file' }).click();
    const written = otio.locator('[data-slot=interchange-written]');
    await expect(written).toContainText('Golden hour market – Golden hour market · 1.otio');
    await expect(written).toContainText(/text items? becomes? markers? with/);
    expect(await ran(page, 'timeline.exportInterchange')).toEqual([
      { name: 'timeline.exportInterchange', source: 'ui' },
    ]);
    await otio.getByRole('button', { name: 'Save as…' }).click();
    await expect(otio.getByText(/Saved a copy as/)).toBeVisible();
    await shot(page, 'pro-export-written-light');
    await toStep(dialog, 'credits');
    const credits = dialog.locator('[data-section=credits]');
    await credits.getByRole('button', { name: 'Copy' }).click();
    await expect(credits.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '"Whoosh short" by kinoton (https://freesound.org/s/612091/) licensed under CC BY 4.0\nVideo by Ana Lima on Pexels',
    );
  });

  test('the keyboard walks every step: each heading takes focus, Tab reaches its controls, Enter moves on', async ({
    page,
  }) => {
    const dialog = await openExport(page);
    const reached: string[] = [];
    const focused = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return '';
        const label = active.getAttribute('aria-label') ?? active.textContent ?? '';
        return `${active.getAttribute('role') ?? active.tagName.toLowerCase()}:${label.trim()}`;
      });
    for (const step of STEPS.slice(0, -1)) {
      await expect(current(dialog, step).getByRole('heading', { level: 3 })).toBeFocused();
      for (let press = 0; press < 40; press += 1) {
        await page.keyboard.press('Tab');
        const name = await focused();
        reached.push(name);
        // The fold opens from the keyboard too.
        if (name === 'button:Or take the cut to another editor') await page.keyboard.press('Enter');
        if (name === 'button:Next') break;
      }
      expect(reached.at(-1), `Next on ${step}`).toBe('button:Next');
      await page.keyboard.press('Enter');
    }
    await expect(current(dialog, 'summary').getByRole('heading', { level: 3 })).toBeFocused();
    for (const control of [
      'button:Write the file',
      'switch:Lower the music under the voice',
      'switch:Hits on the cuts',
      'switch:Voiceover in the video',
      'switch:Smart reframe',
      'switch:Add Content Credentials (C2PA)',
      'button:Copy',
    ])
      expect(
        reached.some((name) => name.startsWith(control)),
        control,
      ).toBe(true);
    await toStep(dialog, 'credits');
    const toggle = dialog.getByRole('switch', { name: 'Add Content Credentials (C2PA)' });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  for (const theme of ['light', 'dark'] as const)
    test(`axe finds nothing with the dialog open, ${theme}`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await page.setViewportSize({ width: 1440, height: 2100 });
      const dialog = await openExport(page);
      await expectAccessible(page, testInfo, `export dialog (${theme})`);
      await shot(page, `dialog-${theme}`);
      await openOtherEditors(dialog);
      await dialog.locator('[data-format=fcpxml]').getByRole('button', { name: 'Write the file' }).click();
      await expect(dialog.locator('[data-format=fcpxml] [data-slot=interchange-written]')).toBeVisible();
      await expectAccessible(page, testInfo, `export dialog, written (${theme})`);
      for (const step of ['sound', 'captions', 'framing']) {
        await toStep(dialog, step);
        await expectAccessible(page, testInfo, `export dialog, ${step} (${theme})`);
      }
      await toStep(dialog, 'credits');
      await dialog.getByRole('switch', { name: 'Add Content Credentials (C2PA)' }).click();
      await expect(dialog.getByText(/Signed with a test certificate/)).toBeVisible();
      await expectAccessible(page, testInfo, `export dialog, signed (${theme})`);
      await shot(page, `dialog-after-${theme}`);
      await toStep(dialog, 'summary');
      await expectAccessible(page, testInfo, `export dialog, summary (${theme})`);
      await shot(page, `dialog-summary-${theme}`);
    });

  test('the pseudo-locale: nothing English, nothing clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await page.setViewportSize({ width: 1440, height: 2100 });
    const dialog = await openExport(page);
    await openOtherEditors(dialog);
    await dialog.locator('[data-format=otio] button').last().click();
    await expect(dialog.locator('[data-format=otio] [data-slot=interchange-written]')).toBeVisible();
    for (const step of STEPS) {
      if (step !== 'destination') {
        await dialog.locator(`[data-slot=export-stepper] button[data-step=${step}]`).click();
        await expect(current(dialog, step)).toBeVisible();
      }
      await settle(page);
      const text = await userFacingText(page);
      expect(englishShowing(text, englishPhrases()), `English source strings on screen (${step})`).toEqual(
        [],
      );
      expect(untranslated(text), `strings that skipped the catalogue (${step})`).toEqual([]);
      // The dialog's own text; the window bar's tooltips behind it are the shell's.
      const inDialog = (await dialog.textContent()) ?? '';
      expect(
        (await clippedText(page)).filter((found) => inDialog.includes(found.text)),
        `clipped (${step})`,
      ).toEqual([]);
      await shot(page, `dialog-en-XA-${step}`);
    }
  });
});

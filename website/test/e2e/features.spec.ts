// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FEATURES } from '../../src/content/features';
import { reelById } from '../../src/content/reels';
import { openInTheme } from './helpers';

/** What each feature page's showcase must show in the server's HTML, with no script at all. */
const IN_HTML: Record<string, readonly string[]> = {
  'reel-breakdown': ['The reel, slot by slot', '1 to check', 'Text on screen', 'How’s Vietnam?'],
  'auto-pick': [
    'Search your clips',
    'A temple front by day',
    'How sure:',
    'Scan the code with your phone',
    'Pick your clips',
  ],
  templates: [
    'The template',
    'Your version',
    'Leading in, to open',
    'Night lights, to close',
    'Fill it from',
    'Your next trip',
    'No reel to copy? Start from a starter',
  ],
  agent: ['Make a reel from my Vietnam clips', 'Check the cut against the reel', 'What changed', 'How hard it thinks'],
  editor: ['Title card', 'A beat shorter', 'OTIO and FCPXML', 'An SRT file'],
  import: ['Phone over Wi-Fi', 'Scan the code with your phone', 'Allow iPhone to send videos?', 'Arriving in your library', 'Fully analysed'],
  shorts: ['Make a short', 'Target length', 'Create short', 'Your short', 'Checked against the original frames'],
  'launch-videos': ['Your video is ready. Open the editor to make it yours.', 'Open editor', 'Approve script & design'],
  'product-videos': ['What’s worth showing next?', 'Why this idea fits', 'Awaiting approval', 'Approve this post and schedule', 'Research this product on a schedule'],
  'instagram-edits': ['Trending sounds & hooks', 'Hook drops 3.5s', 'Cut with AI: 9 slots', 'Stage in Instagram Edits'],
  plugins: ['Can Taalcut go ahead?', 'Export the Vietnam cut for Reels', 'Waiting for your approval', 'Access for the AI', 'Let agents on this Mac use Taalcut'],
};

/** Words a visitor must never read on these pages: the owner's hedge ruling (#content/claims, HEDGES). */
const HEDGE = /\b(draft|samples?|estimated?|placeholder)\b|made up for (the|this) demo|stand(s)? in for/i;

/** The agent's page runs on the third reel, "Vietnam, on repeat" (showcase/agent/run-script.ts). */
const AGENT_SLOTS = reelById('repeat').slots.length;

const showcase = (page: Page, slug: string) => page.locator(`[data-showcase="${slug}"]`);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const [i, f] of FEATURES.entries()) {
    test(`${f.slug}: the answer-first header, the showcase in the app window, what it does, how it works and the next feature are in the HTML`, async ({
      page,
    }) => {
      await page.goto(`/features/${f.slug}/`);
      const main = page.locator('main');
      await expect(page.getByRole('heading', { level: 1, name: f.name })).toBeVisible();
      await expect(page.locator('[data-slot="feature-header"]')).toContainText(f.definition);
      await expect(page.locator('[data-slot="feature-header"] [data-slot="sticker"]')).toHaveCount(3);
      await expect(showcase(page, f.slug)).toBeVisible();
      await expect(
        page
          .getByRole('group', { name: /^A demonstration of the Taalcut app/ })
          .locator(`[data-showcase="${f.slug}"]`),
      ).toHaveCount(1);
      for (const words of IN_HTML[f.slug] ?? []) {
        await expect(main).toContainText(words);
      }
      // What it does: every fact in words beside its icon and its own scene.
      const facts = page.getByRole('region', { name: 'What it does' });
      await expect(facts.locator('dt')).toHaveCount(f.facts.length);
      await expect(facts.locator('[data-slot="vignette"]')).toHaveCount(f.facts.length);
      for (const [label, value] of f.facts) {
        await expect(facts.locator('dt', { hasText: label })).toHaveCount(1);
        await expect(facts).toContainText(value);
      }
      await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
      const next = FEATURES[(i + 1) % FEATURES.length];
      await expect(
        page
          .getByRole('navigation', { name: 'Next feature' })
          .getByRole('link', { name: new RegExp(next?.name ?? '') }),
      ).toHaveAttribute('href', `/features/${next?.slug}/`);
      expect(await main.innerText()).not.toMatch(HEDGE);
      const crumbs = (await page.locator('script[type="application/ld+json"]').allTextContents()).map(
        (s) => JSON.parse(s) as { '@type'?: string },
      );
      expect(crumbs.some((c) => c['@type'] === 'BreadcrumbList')).toBe(true);
    });
  }

  test('the agent’s run is finished in the HTML: every shot checked, the approval waiting', async ({ page }) => {
    await page.goto('/features/agent/');
    const plate = showcase(page, 'agent');
    await expect(plate.locator('[data-step-status="done"]')).toHaveCount(4);
    await expect(plate.locator('[data-slot-state="checked"]')).toHaveCount(AGENT_SLOTS);
    await expect(page.locator('[data-reel-tick="checked"]')).toHaveCount(AGENT_SLOTS);
    await expect(plate.locator('[data-slot="approval"]')).toHaveAttribute('data-status', 'waiting');
    await expect(plate.locator('[data-change]')).toHaveCount(3);
  });

  test('the index lists every feature, each with a fragment of its showcase', async ({ page }) => {
    await page.goto('/features/');
    await expect(page.locator('[data-feature]')).toHaveCount(FEATURES.length);
    for (const f of FEATURES) {
      const entry = page.locator(`[data-feature="${f.slug}"]`);
      await expect(entry.getByRole('heading', { level: 3, name: f.name })).toBeVisible();
      await expect(entry.locator('[data-showcase]')).toBeVisible();
      await expect(entry.getByRole('link', { name: `See how it works: ${f.name}` })).toHaveAttribute(
        'href',
        `/features/${f.slug}/`,
      );
    }
  });
});

test.describe('by keyboard', () => {
  test('reel breakdown: the reel’s 13 slots; a cut moves a frame, a beat, goes back, and the unsure one is checked', async ({
    page,
  }) => {
    await page.goto('/features/reel-breakdown/');
    const plate = showcase(page, 'reel-breakdown');
    await expect(plate.locator('[data-shot]')).toHaveCount(13);
    await expect(plate.getByRole('slider')).toHaveCount(12);
    await expect(plate).toContainText('13 slots');
    await expect(plate).toContainText('Its shots, cuts and words on screen are the reel’s own');
    const cut = page.getByRole('slider', { name: 'Cut 2' });
    await cut.focus();
    const before = Number(await cut.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    await expect(cut).toHaveAttribute('aria-valuetext', /moved by you/);
    expect(Number(await cut.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(plate).toContainText('on a music beat');
    expect(Number(await cut.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(cut).toHaveAttribute('aria-valuenow', String(before));
    await expect(page.locator('[data-slot="to-check"]')).toContainText('1 to check');
    await page.getByRole('slider', { name: 'Cut 3' }).focus();
    await expect(plate).toContainText('isn’t sure this is a cut');
    await expect(plate).toContainText('Temple flags to Neon heart');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-slot="to-check"]')).toContainText('Every cut checked');
  });

  test('auto-pick: search in plain words, then swap the AI’s pick and back', async ({ page }) => {
    await page.goto('/features/auto-pick/');
    const roll = showcase(page, 'auto-pick');
    await roll.getByRole('searchbox', { name: 'Search your clips' }).focus();
    await page.keyboard.type('the night shots');
    await expect(roll.getByRole('status')).toContainText('8 of 37 clips match');
    await expect(roll.locator('li')).toHaveCount(8);
    await page.keyboard.type(' zebra');
    await expect(roll.getByRole('status')).toContainText('No clips match');
    await roll.getByRole('button', { name: 'Clear search' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(roll.locator('li')).toHaveCount(37);

    const slot = showcase(page, 'auto-pick-slot');
    const pick = slot.locator('[data-slot="pick"]');
    await expect(pick).toHaveAttribute('data-by', 'ai');
    await expect(pick).toContainText(/How sure:\s*High/);
    await expect(slot).not.toContainText(/reason/i);
    await expect(slot.getByRole('listitem')).toHaveCount(3);
    await slot.getByRole('button', { name: 'Use this: Stone gate' }).focus();
    await page.keyboard.press('Enter');
    await expect(pick).toHaveAttribute('data-by', 'you');
    await expect(pick).toContainText('You changed this');
    await expect(pick).toContainText(/How sure:\s*Medium/);
    await expect(slot.getByRole('button', { name: /^AI pick ?, A temple front by day$/ })).toBeVisible();
    await expect(slot).toContainText('Taalcut picked “A temple front by day”');
    await slot.getByRole('button', { name: 'Back to the AI pick' }).focus();
    await page.keyboard.press('Enter');
    await expect(pick).toHaveAttribute('data-by', 'ai');
  });

  test('editor: trim a clip a beat with ] and [, move between clips, and change the title’s values', async ({
    page,
  }) => {
    await page.goto('/features/editor/');
    const plate = showcase(page, 'editor');
    const clip = plate.getByRole('option', { selected: true });
    await expect(clip).toHaveAttribute('aria-label', /^Clip 3 .*AI pick$/);
    const width = async () => (await plate.locator('[data-clip="2"]').boundingBox())?.width ?? 0;
    const before = await width();
    await clip.focus();
    // Shift and an arrow is no trim (the app trims with [ and ]); the arrow only moves to the clip beside.
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(plate.locator('[data-trimmed]')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('option', { selected: true })).toHaveAttribute('aria-label', /^Clip 3 /);
    await page.keyboard.press(']');
    await expect(plate.getByRole('option', { name: /^Clip 3 .*AI pick, trimmed$/ })).toBeVisible();
    expect(await width()).toBeGreaterThan(before);
    await expect(plate).toContainText('Trimmed');
    await expect(plate.locator('[data-by="you"]')).toHaveCount(0);
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    expect(await width()).toBeLessThan(before);
    await expect(plate.locator('[data-by="you"]')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('option', { selected: true })).toHaveAttribute('aria-label', /^Clip 4 /);
    await plate.getByRole('slider', { name: 'Size' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(plate.locator('output')).toHaveText('1.05×');
    await plate.getByRole('radio', { name: 'Top' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('radio', { name: 'Middle' })).toHaveAttribute('aria-checked', 'true');
    await plate.getByRole('button', { name: 'Play' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(plate.getByRole('button', { name: 'Play' })).toBeVisible();
  });
});

test.describe('by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('reel breakdown: tap a cut, then Frame later and Frame earlier move it a frame each way', async ({
    page,
  }) => {
    await page.goto('/features/reel-breakdown/');
    const plate = showcase(page, 'reel-breakdown');
    const later = plate.getByRole('button', { name: 'Frame later' });
    const earlier = plate.getByRole('button', { name: 'Frame earlier' });
    await expect(later).toBeDisabled();
    await expect(earlier).toBeDisabled();
    // The lanes keep their spacing and scroll sideways inside the plate, and say so.
    await expect(plate.getByRole('group', { name: 'The reel on one time axis' })).toHaveJSProperty(
      'scrollLeft',
      0,
    );
    await expect(plate).toContainText('Scroll the lanes sideways to reach every cut.');
    const cut = plate.getByRole('slider', { name: 'Cut 2' });
    const before = Number(await cut.getAttribute('aria-valuenow'));
    await cut.tap();
    // A tap chooses the cut and never moves it.
    await expect(plate.locator('p').filter({ hasText: /^Cut 2/ })).toBeVisible();
    expect(Number(await cut.getAttribute('aria-valuenow'))).toBe(before);
    await later.tap();
    await expect(cut).toHaveAttribute('aria-valuetext', /moved by you/);
    expect(Number(await cut.getAttribute('aria-valuenow'))).toBeCloseTo(before + 1 / 30, 5);
    await expect(plate.getByRole('status').filter({ hasText: /^Cut 2 at / })).toHaveCount(1);
    await earlier.tap();
    await expect(cut).toHaveAttribute('aria-valuenow', String(before));
    await expect(cut).not.toHaveAttribute('aria-valuetext', /moved by you/);
  });
});

test.describe('the breakdown’s cut grips (WCAG 2.5.8)', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 375, 414, 640, 1440]) {
      for (const path of ['/features/reel-breakdown/', '/features/']) {
        test(`${path} at ${width} px in ${theme}: axe's target-size passes, and no two grips overlap`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await openInTheme(page, path, theme);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const plate = page.locator('[data-showcase^="reel-breakdown"]');
          const result = await new AxeBuilder({ page })
            .include('[data-showcase^="reel-breakdown"]')
            .withRules(['target-size'])
            .analyze();
          expect(
            result.violations.flatMap((v) =>
              v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
            ),
          ).toEqual([]);
          const boxes = await plate
            .getByRole('slider')
            .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
          expect(boxes).toHaveLength(12);
          const overlaps: string[] = [];
          for (const [i, a] of boxes.entries()) {
            for (const [j, b] of boxes.entries()) {
              const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (j > i && x > 0.5 && y > 0.5) overlaps.push(`Cut ${i + 1} and Cut ${j + 1}`);
            }
          }
          expect(overlaps).toEqual([]);
          expect(Math.min(...boxes.map((b) => b.width))).toBeGreaterThanOrEqual(24);
        });
      }
    }
  }
});

test.describe('the agent’s run', () => {
  test('waits with its slots as numbers, runs when scrolled to, swaps a missed shot, ends checked', async ({ page }) => {
    await page.goto('/features/agent/');
    const plate = showcase(page, 'agent');
    const chat = plate.locator('[data-replay]');
    await expect(chat).toHaveAttribute('data-replay', 'waiting');
    await expect(plate.locator('[data-slot-state="waiting"]')).toHaveCount(AGENT_SLOTS);
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-slot-state="missed"]')).toHaveCount(1, { timeout: 6_000 });
    await expect(chat).toHaveAttribute('data-replay', 'finished', { timeout: 8_000 });
    await expect(page.locator('[data-reel-tick="checked"]')).toHaveCount(AGENT_SLOTS);
    await expect(plate.locator('[data-slot="approval"]')).toContainText('Checked: 5 of 5 passed');
  });

  test('by keyboard: undo a swap, the check misses; redo; review shows Your version; export', async ({ page }) => {
    await page.goto('/features/agent/');
    const plate = showcase(page, 'agent');
    const changes = plate.locator('[data-slot="changes"]');
    const approval = plate.locator('[data-slot="approval"]');
    const press = async (name: string, where = plate) => {
      await where.getByRole('button', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
    };
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-replay]')).toHaveAttribute('data-replay', 'finished', { timeout: 8_000 });
    await press('Undo');
    await expect(changes).toContainText('Undone: Opening title');
    await press('Undo');
    await expect(changes.getByRole('listitem')).toHaveCount(1);
    await expect(page.locator('[data-reel-tick="missed"]')).toHaveCount(1);
    await expect(approval).toContainText('Checked: 4 of 5 passed');
    await expect(approval.getByRole('button', { name: 'Review and export' })).toBeDisabled();
    await press('Redo');
    await expect(plate.locator('[data-slot-state="missed"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Your version' })).toHaveAttribute('aria-disabled', 'true');
    await press('Review and export');
    await expect(approval).toHaveAttribute('data-status', 'reviewing');
    await expect(page.getByRole('button', { name: 'Your version' })).toHaveAttribute('aria-pressed', 'true');
    await press('Export');
    await expect(approval).toContainText('Exported.');
    const think = plate.getByRole('radiogroup', { name: 'How hard it thinks' });
    await think.getByRole('radio', { name: 'Medium' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(think.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    await press('Replay');
    await expect(plate.locator('[data-replay]')).toHaveAttribute('data-replay', 'finished', { timeout: 8_000 });
    await expect(approval).toHaveAttribute('data-status', 'waiting');
    await expect(page.getByRole('button', { name: 'Saved reel' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the agent shows its finished run at once, and nothing runs by itself', async ({ page }) => {
    await page.goto('/features/agent/');
    const plate = showcase(page, 'agent');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-replay]')).toHaveAttribute('data-replay', 'finished');
    await plate.getByRole('button', { name: 'Replay' }).click();
    await expect(plate.locator('[data-replay]')).toHaveAttribute('data-replay', 'finished');
    await expect(plate.locator('[data-slot-state="checked"]')).toHaveCount(AGENT_SLOTS);
  });

  test('the breakdown’s arrival never runs', async ({ page }) => {
    await page.goto('/features/reel-breakdown/');
    await expect(showcase(page, 'reel-breakdown').locator('[data-arrival]')).toHaveAttribute(
      'data-arrival',
      'reduced',
    );
  });
});

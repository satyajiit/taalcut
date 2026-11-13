// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Page, test } from '@playwright/test';
import { COST_SECTION } from '../../src/content/cost';
import { FAQ } from '../../src/content/faq';
import { FAQ_TEASER, FILM_SECTION, HOW, KAATU_SECTION, MORE_WAYS, PLATFORMS_SECTION, PRIVATE_SECTION, ROLL_PROBLEM, SAVED_PROBLEM, STARTERS_SECTION, TOUR, YOUR_AI_SECTION } from '../../src/content/home';
import { STARTER_FORMATS } from '../../src/content/home-starters';
import { PROVIDERS } from '../../src/content/providers';

/** The home's sections below the hero, by id, with a line of each one's words. */
const SECTIONS: readonly (readonly [id: string, words: string])[] = [
  [FILM_SECTION.id, FILM_SECTION.lead],
  [ROLL_PROBLEM.id, ROLL_PROBLEM.lead],
  [SAVED_PROBLEM.id, SAVED_PROBLEM.lead],
  ['how-it-works', HOW.steps[1].line],
  ['features', TOUR.rows['reel-breakdown'].line],
  [MORE_WAYS.id, MORE_WAYS.rows.import.line],
  ['formats', STARTERS_SECTION.lead],
  ['your-ai', YOUR_AI_SECTION.lead],
  [COST_SECTION.id, COST_SECTION.lead],
  ['private', PRIVATE_SECTION.facts[5]],
  ['platforms', 'Comes after 1.0'],
  ['kaatu', KAATU_SECTION.lead],
  ['questions', FAQ.find((f) => f.id === FAQ_TEASER.ids[0])!.question],
];

/** Walks the page down so every section arrives, then back up. */
async function walk(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every section has its heading, its words and its icons', async ({ page }) => {
    await page.goto('/');
    for (const [id, words] of SECTIONS) {
      const section = page.locator(`section#${id}`);
      await expect(section.getByRole('heading', { level: 2 }), id).toBeVisible();
      await expect(section.getByText(words, { exact: false }).first(), id).toBeVisible();
      // Icons ride the rows, chips, stickers and links inside, never a tile by the heading.
      expect(await section.locator('svg').count(), id).toBeGreaterThan(0);
    }
    await expect(page.locator('section#problem-roll [data-picked]')).toHaveCount(13);
    await expect(page.locator('[data-tour]')).toHaveCount(5);
    await expect(page.locator('[data-format]')).toHaveCount(STARTER_FORMATS.length);
    await expect(page.locator('[data-hero]')).toHaveCount(1);
    // Nothing a visitor reads starts hidden in the server HTML.
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('main h2, main h3, main p')].filter((el) => getComputedStyle(el).opacity === '0').map((el) => el.textContent),
    );
    expect(hidden).toEqual([]);
  });

  test('Kaatu’s name is in Hindi, marked as such', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('section#kaatu [lang="hi"]')).toHaveText(KAATU_SECTION.word);
  });
});

test.describe('the questions', () => {
  test('open and close by keyboard', async ({ page }) => {
    await page.goto('/');
    const first = page.locator('section#questions details').first();
    const summary = first.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('open', '');
    const answer = FAQ.find((f) => f.id === FAQ_TEASER.ids[0])!.answer;
    await expect(first.getByText(answer)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(first).not.toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(page.locator('section#questions details').nth(1).locator('summary')).toBeFocused();
  });
});

test.describe('the starter formats', () => {
  test('scroll with their buttons, which stop at the ends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.locator('section#formats');
    await section.scrollIntoViewIfNeeded();
    const previous = section.getByRole('button', { name: STARTERS_SECTION.previous });
    const next = section.getByRole('button', { name: STARTERS_SECTION.next });
    const row = section.getByRole('list', { name: STARTERS_SECTION.region });
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await next.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await expect(previous).toBeEnabled();
    for (let i = 0; i < 8 && (await next.isEnabled()); i += 1) {
      await next.click();
      await page.waitForTimeout(450);
    }
    await expect(next).toBeDisabled();
    expect(await row.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)).toBe(true);
    await previous.click();
    await expect(next).toBeEnabled();
  });

  test('play a format’s shape from its button', async ({ page }) => {
    await page.goto('/');
    const card = page.locator(`[data-format="${STARTER_FORMATS[0]!.id}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: STARTERS_SECTION.play(STARTER_FORMATS[0]!.name) }).click();
    await expect(card.locator('[data-slot="segment-bar"]')).toHaveAttribute('data-state', 'playing');
    await expect(card.locator('[data-slot="segment-bar"]')).toHaveAttribute('data-state', 'filled', { timeout: 5_000 });
  });
});

test.describe('your AI', () => {
  test('the Local only switch works by pointer and keyboard and says what it means', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section#your-ai');
    const toggle = section.getByRole('switch', { name: new RegExp(YOUR_AI_SECTION.local.label) });
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByText(YOUR_AI_SECTION.local.off)).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByText(YOUR_AI_SECTION.local.on)).toBeVisible();
    await expect(section.getByText(YOUR_AI_SECTION.local.paused).first()).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('names every provider in words beside its icon', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section#your-ai');
    for (const p of PROVIDERS.filter((x) => x.way !== 'on-device')) {
      await expect(section.locator('[data-slot="brand-mark"]', { hasText: p.name }).first(), p.name).toBeVisible();
    }
    // Your own server is Ollama and LM Studio, nothing else.
    expect(PROVIDERS.filter((x) => x.way === 'own-server').map((x) => x.name)).toEqual(['Ollama', 'LM Studio']);
  });
});

test.describe('Paste, pick, approve', () => {
  test('plays once on screen, pauses, and takes a step by its button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.locator('section#how-it-works');
    await section.scrollIntoViewIfNeeded();
    const pause = section.getByRole('button', { name: HOW.controls.pause });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(section.getByRole('button', { name: HOW.controls.play })).toBeVisible();
    const pick = section.getByRole('button', { name: HOW.stepButton(2, HOW.steps[1].title) });
    await pick.click();
    await expect(pick).toHaveAttribute('aria-current', 'step');
    await expect(section.getByRole('button', { name: HOW.controls.pause })).toBeVisible();
  });
});

test.describe('Meet Kaatu', () => {
  test('a poke plays its next trick and names it', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section#kaatu');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText(KAATU_SECTION.tricks[0], { exact: true })).toBeVisible();
    await section.getByRole('button', { name: KAATU_SECTION.poke }).click();
    await expect(section.getByText(KAATU_SECTION.tricks[1], { exact: true })).toBeVisible();
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('every section shows its finished state, with nothing to pause or play again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Below the fold at load, yet already finished: no arrival hides it.
    const heading = page.locator('section#questions h2');
    expect(await heading.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await walk(page);
    await expect(page.getByRole('button', { name: TOUR.replay })).toHaveCount(0);
    await expect(page.locator('section#how-it-works').getByRole('button', { name: HOW.controls.pause })).toHaveCount(0);
    const chips = page.locator('section#problem-roll [data-picked] .rounded-pill');
    for (const chip of await chips.all()) expect(await chip.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe('1');
    const faded = await page.evaluate(() =>
      [...document.querySelectorAll('main section h2, main section h3')].filter((el) => getComputedStyle(el).opacity !== '1').map((el) => el.textContent),
    );
    expect(faded).toEqual([]);
  });
});

test.describe('the feature tour', () => {
  /** Names up to 24 characters stay on one line, inside their cell. */
  const LONG = ['Your camera roll, sorted', 'Every reel is a template'];

  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`keeps every name on one line at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const names = page.locator('[data-feature-name]');
      await expect(names).toHaveCount(5);
      for (const text of [null, ...LONG]) {
        const lines = await names.evaluateAll((els, name) => {
          return els.map((el) => {
            if (name) el.textContent = name;
            const r = el.getBoundingClientRect();
            const cell = el.parentElement!.getBoundingClientRect();
            const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
            return { text: el.textContent, lines: Math.round(r.height / lineHeight), inside: r.right <= cell.right + 0.5 };
          });
        }, text);
        for (const line of lines) expect(line, `${line.text} at ${width}px`).toMatchObject({ lines: 1, inside: true });
      }
    });
  }

  test('links each row to its feature page', async ({ page }) => {
    await page.goto('/');
    for (const [slug, row] of Object.entries(TOUR.rows)) {
      await expect(page.locator(`[data-tour="${slug}"]`).getByRole('link', { name: row.more })).toHaveAttribute('href', `/features/${slug}/`);
    }
  });
});

test.describe('reflow', () => {
  for (const width of [320, 390]) {
    test(`fits ${width} px with no sideways scroll, every section walked through`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await walk(page);
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      for (const [id] of SECTIONS) {
        const box = await page.locator(`section#${id} h2`).boundingBox();
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(width + 0.5);
      }
    });
  }
});

/** Every h1 and h2 in the page's main that has an icon tile beside it (a sibling) or inside it. */
function headingsWithTiles(page: Page) {
  return page.evaluate(() => {
    /** A tile: a squarish box from 24 to 96 px with a filled ground or a shadow, holding a drawn icon. */
    const isTile = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.width > 96 || Math.abs(r.width - r.height) > 6) return false;
      if (!(el instanceof SVGElement) && !el.querySelector('svg')) return false;
      const style = getComputedStyle(el);
      const ground = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
      return ground || style.boxShadow !== 'none';
    };
    const slots = '[data-slot="section-icon"], [data-slot="feature-icon"], [data-slot="page-head-icon"]';
    return [...document.querySelectorAll('main h1, main h2')]
      .filter((h) => h.getClientRects().length > 0)
      .filter((h) => {
        const near = [...(h.parentElement?.children ?? [])].filter((el) => el !== h);
        return near.some((el) => el.matches(slots) || isTile(el)) || [...h.querySelectorAll('*')].some((el) => el.matches(slots) || isTile(el));
      })
      .map((h) => `${h.tagName} ${h.textContent?.trim() ?? ''}`);
  });
}

test.describe('the headings', () => {
  for (const path of ['/', '/features/', '/ai/', '/about/']) {
    test(`on ${path} stand alone, with no icon tile beside them`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      expect(await page.locator('main h1').count()).toBe(1);
      expect(await page.locator(`main :is(${['section-icon', 'feature-icon', 'page-head-icon'].map((s) => `[data-slot="${s}"]`).join(', ')})`).count()).toBe(0);
      expect(await headingsWithTiles(page)).toEqual([]);
    });
  }

  test('a marker is one sticker carrying its section’s fact, on two places at most', async ({ page }) => {
    await page.goto('/');
    const markers = page.locator('main [data-slot="section-marker"]');
    expect(await markers.count()).toBeLessThanOrEqual(2);
    await expect(page.locator('section#problem-roll [data-slot="section-marker"] [data-slot="sticker"]')).toHaveText(ROLL_PROBLEM.sticker);
  });
});

test.describe('the feature tour’s grid', () => {
  test('sets the header’s link on the h2’s last line and every row’s words level with its window’s title bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const header = page.locator('section#features header');
    await header.scrollIntoViewIfNeeded();
    const h2 = (await header.locator('h2').boundingBox())!;
    const all = (await header.getByRole('link', { name: TOUR.all }).boundingBox())!;
    // In the right half, ending on the h2's last line.
    expect(all.x).toBeGreaterThan(h2.x + h2.width);
    expect(Math.abs(all.y + all.height - (h2.y + h2.height))).toBeLessThanOrEqual(16);
    const sides: string[] = [];
    for (const slug of Object.keys(TOUR.rows)) {
      const row = page.locator(`[data-tour="${slug}"]`);
      await row.scrollIntoViewIfNeeded();
      const name = (await row.locator('h3').boundingBox())!;
      const bar = (await row.locator('[data-slot="app-window-bar"]').boundingBox())!;
      const window = (await row.locator('[data-slot="app-window"]').boundingBox())!;
      // The name's line sits within the title bar's height, the words beside the window, never centred over it.
      expect(name.y, slug).toBeGreaterThanOrEqual(bar.y - 2);
      expect(name.y + name.height, slug).toBeLessThanOrEqual(bar.y + bar.height + 2);
      expect(window.width, slug).toBeGreaterThan(640);
      expect(window.width, slug).toBeLessThan(800);
      sides.push(name.x > window.x ? 'demo-left' : 'demo-right');
    }
    expect(sides).toEqual(['demo-left', 'demo-right', 'demo-left', 'demo-right', 'demo-left']);
  });

  test('plays a demo again from the icon button in its window’s title bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    for (const slug of Object.keys(TOUR.rows)) {
      const replay = page.locator(`[data-tour="${slug}"] [data-slot="app-window-bar"]`).getByRole('button', { name: TOUR.replay });
      await expect(replay, slug).toHaveCount(1);
    }
    await expect(page.locator('section#problem-roll [data-slot="app-window-bar"]').getByRole('button', { name: TOUR.replay })).toHaveCount(1);
    // No visible "Play again" words anywhere: the button is named, its face is the icon.
    await expect(page.getByText(TOUR.replay, { exact: true })).toHaveCount(0);
    const replay = page.locator('[data-tour="auto-pick"] [data-slot="app-window-bar"]').getByRole('button', { name: TOUR.replay });
    await replay.scrollIntoViewIfNeeded();
    const box = (await replay.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    await replay.click();
    // The run starts over: the found clips step back to their first frame, then play to the finished state.
    const first = page.locator('[data-tour="auto-pick"] [data-slot="app-window-page"] .grid-cols-4 > div').first();
    await expect.poll(() => first.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 2000 }).toBeLessThan(1);
    await expect.poll(() => first.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 6000 }).toBe(1);
  });

  test('gives the editor’s preview a stage over 300 px tall, the preview at its full height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const preview = page.locator('[data-tour="editor"] [data-slot="editor-preview"]');
    await preview.scrollIntoViewIfNeeded();
    const stage = (await preview.evaluate((el) => el.parentElement!.getBoundingClientRect().toJSON())) as DOMRect;
    const frame = (await preview.boundingBox())!;
    expect(stage.height).toBeGreaterThanOrEqual(300);
    expect(frame.height).toBeGreaterThanOrEqual(stage.height - 32);
    expect(frame.width / frame.height).toBeCloseTo(9 / 16, 1);
  });
});

test.describe('the platforms', () => {
  test('are /download/’s platform stickers, each a link with its brand, its name and the one line it needs', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section#platforms');
    for (const [id, brand] of [
      ['macos', 'apple'],
      ['ubuntu', 'ubuntu'],
      ['windows', 'windows'],
    ] as const) {
      const item = section.locator(`[data-platform="${id}"]`);
      const link = item.getByRole('link', { name: PLATFORMS_SECTION.names[id] });
      await expect(link, id).toHaveAttribute('href', `/download/#${id}`);
      await expect(link.locator(`[data-slot="brand-icon"][data-brand="${brand}"]`), id).toHaveCount(1);
      await expect(item.getByText(PLATFORMS_SECTION.needs[id]), id).toBeVisible();
    }
    // No equal cards and no motif bar that carries no state.
    await expect(section.locator('[data-slot="segment-bar"]')).toHaveCount(0);
  });
});

test.describe('Meet Kaatu’s stage', () => {
  test('draws Kaatu at about three quarters of its disc and each photo at 120 px or more', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const stage = page.locator('section#kaatu [data-slot="kaatu-stage"]');
    await stage.scrollIntoViewIfNeeded();
    const sizes = await stage.evaluate((el) => {
      // The drawing fills 62 % of its 480 px cell's height (the atlases' margins); the disc is the stage's widest circle.
      const disc = [...el.querySelectorAll(':scope > span.rounded-full')].map((d) => d.getBoundingClientRect().height);
      const main = el.querySelector('[data-slot="kaatu-poke"]')!.getBoundingClientRect().height;
      const photos = [...el.querySelectorAll('[data-photo] [data-slot="kaatu"]')].map((k) => k.getBoundingClientRect().height);
      return { disc: Math.max(...disc), main, photos };
    });
    expect((sizes.main * 0.62) / sizes.disc).toBeGreaterThan(0.68);
    expect((sizes.main * 0.62) / sizes.disc).toBeLessThan(0.85);
    expect(sizes.photos).toHaveLength(3);
    for (const h of sizes.photos) expect(h * 0.62).toBeGreaterThanOrEqual(120);
  });

  test('a photo plays its own trick and names it', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section#kaatu');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('button', { name: KAATU_SECTION.poses.snip, exact: true }).click();
    await expect(section.getByText(KAATU_SECTION.tricks[4], { exact: true })).toBeVisible();
    await expect(section.locator('[data-photo="snip"]')).toHaveAttribute('data-playing');
    await section.getByRole('button', { name: KAATU_SECTION.poses.headphones, exact: true }).click();
    await expect(section.getByText(KAATU_SECTION.tricks[3], { exact: true })).toBeVisible();
    await expect(section.locator('[data-photo="snip"]')).not.toHaveAttribute('data-playing');
    await expect(section.locator('[data-photo="headphones"]')).toHaveAttribute('data-playing');
  });
});

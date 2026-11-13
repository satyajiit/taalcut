// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone upload page (packages/transfer/phone) served from its source files exactly as the lan process
// serves it (its asset map and CSP are read from the transfer package's source), with a stand-in Mac behind
// it: pairing (the PIN, and approval on the computer: phone-page-approval-support.ts), the session poll, lookups
// and a tus stand-in whose uploads finish, hold part-way or fail by file name. Each test gets its own FakeMac,
// so it can take the Mac away, close its phone screen or forget the phone and watch the page answer. Shared by
// the phone-page*.spec.ts files.
import { mkdirSync, readFileSync } from 'node:fs';
import { devices, expect, type Browser, type Page, type Route } from '@playwright/test';
import { FakeApproval } from './phone-page-approval-support.ts';
import { ARTIFACTS, watchProblems } from './support.ts';

export const ORIGIN = 'http://phone.taalcut.test';
export const QR_TOKEN = 'qr-token-0123456789';
export const GOOD_PIN = '482913';
/** Answered with 429 and Retry-After: 1. Any other PIN but GOOD_PIN is refused with 401. */
export const BUSY_PIN = '222222';
/** The setup code a page opened without the QR must send, as the Mac checks it (the Mac shows "7KD2 M9QX"). */
export const SETUP_CODE = '7KD2M9QX';
const TRANSFER = new URL('../../../packages/transfer/', import.meta.url);
const PHONE = new URL('phone/', TRANSFER);
const source = (path: string) => readFileSync(new URL(path, TRANSFER), 'utf8');
const CSP = /'Content-Security-Policy':\s*"([^"]+)"/.exec(source('src/http/headers.ts'))?.[1] ?? '';
/** /assets/<name> → file in the phone directory, from PHONE_PAGE_FILES, so the two can't drift. */
const ASSETS = new Map(
  [...source('src/phone-assets.ts').matchAll(/\['([\w.-]+)', '([\w./-]+)', /g)].map((m) => [m[1], m[2]]),
);
const TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  woff2: 'font/woff2',
  png: 'image/png',
};
export const SHOTS = process.env.TAALCUT_PHONE_SCREENS ?? new URL('screenshots/phone/', ARTIFACTS).pathname;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const GALAXY =
  'Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** `scale`: the device pixel ratio (2 unless a real phone's profile says otherwise). */
export type Device = {
  name: string;
  width: number;
  height: number;
  userAgent: string;
  picker: string;
  scale?: number;
};
/** The brief's four widths: the smallest phones, iPhone SE, the Galaxy S26 Ultra, the largest iPhones. */
export const DEVICES: readonly Device[] = [
  { name: '320', width: 320, height: 640, userAgent: IPHONE, picker: '#pick-files' },
  { name: '375', width: 375, height: 667, userAgent: IPHONE, picker: '#pick-files' },
  { name: '412', width: 412, height: 915, userAgent: GALAXY, picker: '#pick-any' },
  { name: '430', width: 430, height: 932, userAgent: IPHONE, picker: '#pick-files' },
];
export const GALAXY_S26 = DEVICES[2] as Device;

/** One of Playwright's phone profiles, as a Device. */
export function profile(name: 'iPhone 15' | 'Pixel 8' | 'iPhone 15 landscape' | 'Pixel 8 landscape'): Device {
  const { viewport, userAgent, deviceScaleFactor } = devices[name];
  const slug = name.toLowerCase().replaceAll(' ', '-');
  const picker = name.startsWith('iPhone') ? '#pick-files' : '#pick-any';
  return { name: slug, ...viewport, userAgent, picker, scale: deviceScaleFactor };
}

export type Clip = { name: string; size: number };
/** Five clips in five states while one holds part-way (see FakeMac.lookup and FAKE_TUS). */
export const SENDING: readonly Clip[] = [
  { name: 'IMG_0412.MOV', size: 2_400_000 }, // the Mac has it, as Photos' smaller copy: Added
  { name: 'IMG_0415.MOV', size: 1_800_000 }, // the Mac has it: Already on your Mac
  { name: 'market-walk-4k.mov', size: 3_100_000 }, // 413: Couldn't send, too big
  { name: 'golden-hour-b-roll.mp4', size: 2_600_000 }, // holds at 42 %
  { name: 'chai-pour-slowmo.mov', size: 1_200_000 }, // behind it: Waiting
];
/** Everything settles: two arrive, the Mac refuses one after it arrives, one is too big. */
export const SETTLING: readonly Clip[] = [
  { name: 'IMG_0412.MOV', size: 2_400_000 },
  { name: 'beach-sunset.mov', size: 1_500_000 },
  { name: 'scan-receipt.pdf', size: 300_000 },
  { name: 'market-walk-4k.mov', size: 3_100_000 },
];

/**
 * Stands in for tus-js-client by file name: market* fails with 413, golden* holds at 42 % (after creating
 * its upload, so a resume and a stop have a URL), flaky* fails once with 403 and then finishes, everything
 * else finishes. Uploads are created, advanced and finished through /files/ so the FakeMac sees them.
 */
const FAKE_TUS = `(() => {
  const tries = new Map();
  const failure = (status) => ({ originalResponse: { getStatus: () => status, getHeader: () => null } });
  class Upload {
    constructor(file, options) { this.file = file; this.options = options; this.url = options.uploadUrl || null; this.timers = []; }
    static terminate(url, options) {
      return fetch(url, { method: 'DELETE', headers: options && options.headers }).then((r) => { if (!r.ok) throw new Error(String(r.status)); });
    }
    later(ms, run) { this.timers.push(setTimeout(() => { if (!this.stopped) run(); }, ms)); }
    patch(body) {
      return fetch(this.url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    async start() {
      this.stopped = false;
      const { file, options } = this;
      const attempt = (tries.get(file.name) || 0) + 1;
      tries.set(file.name, attempt);
      if (file.name.startsWith('market')) return this.later(20, () => options.onError(failure(413)));
      if (file.name.startsWith('flaky') && attempt === 1) return this.later(20, () => options.onError(failure(403)));
      if (!this.url) {
        const created = await fetch('/files/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size }) });
        this.url = new URL(created.headers.get('Location'), location.origin).href;
        options.onUploadUrlAvailable && options.onUploadUrlAvailable();
      }
      const step = (fraction) => { const sent = Math.round(file.size * fraction); void this.patch({ offset: sent }); options.onProgress(sent, file.size); };
      if (file.name.startsWith('golden')) {
        this.later(20, () => step(0.3));
        this.later(700, () => step(0.42));
        return;
      }
      this.later(20, () => step(0.5));
      this.later(220, () => { void this.patch({ offset: file.size, done: true }).then(() => { if (!this.stopped) options.onSuccess(); }); });
    }
    abort() { this.stopped = true; this.timers.forEach(clearTimeout); return Promise.resolve(); }
  }
  window.tus = { Upload };
})();`;

export type MacFile = {
  id: string;
  name: string;
  sizeBytes: number;
  state: string;
  receivedBytes: number;
  error?: { code: string };
  reencode?: { verdict: string };
};

/** The Mac behind the page. `mode`: up; down (no answer); closed (its phone screen is shut: 404); expired (401). */
export class FakeMac {
  mode: 'up' | 'down' | 'closed' | 'expired' = 'up';
  files: MacFile[] = [];
  terminated: string[] = [];
  resumed: string[] = [];
  pairs = 0;
  /** The setup code of the last pairing request without the QR's token. */
  code: string | undefined;
  /** The computer's answers to a phone that asks it (opened from the QR). */
  approval = new FakeApproval();
  private count = 0;

  lookup(name: string): unknown {
    if (name === 'IMG_0412.MOV') return { matches: [{ index: 0, state: 'imported', reencode: { verdict: 'likely' } }] };
    if (name === 'IMG_0415.MOV') return { matches: [{ index: 0, state: 'duplicate' }] };
    const open = this.files.find((file) => file.name === name && file.state === 'uploading');
    if (!open) return { matches: [] };
    this.resumed.push(open.id);
    return { matches: [{ index: 0, state: 'uploading', uploadId: open.id, receivedBytes: open.receivedBytes }] };
  }

  /** The session the phone polls. A file being added is added by the next poll. */
  session(): unknown {
    const files = this.files.map((file) => ({ ...file }));
    for (const file of this.files) if (file.state === 'importing') file.state = 'imported';
    return { accepting: true, files };
  }

  create(name: string, size: number): string {
    this.count += 1;
    const id = `01JPHONE${String(this.count).padStart(6, '0')}`;
    this.files.push({ id, name, sizeBytes: size, state: 'uploading', receivedBytes: 0 });
    return id;
  }

  advance(id: string, offset: number, done: boolean): void {
    const file = this.files.find((entry) => entry.id === id);
    if (!file) return;
    file.receivedBytes = offset;
    if (!done) return;
    if (file.name.startsWith('scan')) Object.assign(file, { state: 'rejected', error: { code: 'transfer.not_media' } });
    else file.state = 'importing';
  }
}

async function serve(page: Page, mac: FakeMac, tus: 'real' | 'fake'): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort('blockedbyclient');
    const path = url.pathname;
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, json: body, headers });
    if (path === '/') {
      const body = readFileSync(new URL('index.html', PHONE));
      return route.fulfill({ body, contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': CSP } });
    }
    if (path.startsWith('/assets/')) return asset(route, path.slice('/assets/'.length), tus);
    if (path === '/api/pair') {
      mac.pairs += 1;
      if (mac.mode === 'down') return route.abort('connectionrefused');
      const { pin, code } = request.postDataJSON() as { pin?: string; code?: string };
      mac.code = code;
      if (code !== undefined && code !== SETUP_CODE) return json({ error: { code: 'pair.rejected' } }, 401);
      if (pin === BUSY_PIN) return json({ error: { code: 'pair.rate' } }, 429, { 'Retry-After': '1' });
      if (pin !== GOOD_PIN) return json({ error: { code: 'pair.rejected' } }, 401);
      mac.mode = 'up';
      return json({ deviceId: 'phone-1', credential: 'credential-1' });
    }
    if (/^\/api\/pair\/(?:ask|wait|cancel)$/.test(path)) {
      if (mac.mode === 'down') return route.abort('connectionrefused');
      if (mac.mode === 'closed') return json({ error: { code: 'transfer.closed' } }, 404);
      const reply = mac.approval.handle(path, request.postDataJSON() as Record<string, unknown>);
      if ((reply.body as { state?: string } | undefined)?.state === 'allowed') mac.mode = 'up';
      if (reply.body === undefined) return route.fulfill({ status: reply.status });
      return json(reply.body, reply.status, reply.headers);
    }
    // The modes act on the API; an upload already under way is the tus stand-in's business.
    if (path.startsWith('/api/') && mac.mode === 'down') return route.abort('connectionrefused');
    if (path.startsWith('/api/') && mac.mode === 'closed') return json({ error: { code: 'transfer.closed' } }, 404);
    if (path.startsWith('/api/') && mac.mode === 'expired') return json({ error: { code: 'auth.expired' } }, 401);
    if (path === '/api/session') return json(mac.session());
    if (path === '/api/uploads/lookup') {
      const { files } = request.postDataJSON() as { files: { name: string }[] };
      return json(mac.lookup(files[0]?.name ?? ''));
    }
    if (path === '/files/' && request.method() === 'POST') {
      const { name, size } = request.postDataJSON() as { name: string; size: number };
      return route.fulfill({ status: 201, headers: { Location: `/files/${mac.create(name, size)}` } });
    }
    const id = /^\/files\/([\w-]+)$/.exec(path)?.[1];
    if (id && request.method() === 'PATCH') {
      const { offset, done } = request.postDataJSON() as { offset: number; done?: boolean };
      mac.advance(id, offset, Boolean(done));
      return route.fulfill({ status: 204 });
    }
    if (id && request.method() === 'DELETE') {
      mac.terminated.push(id);
      mac.files = mac.files.filter((file) => file.id !== id);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });
}

function asset(route: Route, name: string, tus: 'real' | 'fake'): Promise<void> {
  if (name === 'tus.min.js') {
    const body =
      tus === 'fake' ? FAKE_TUS : readFileSync(new URL('node_modules/tus-js-client/dist/tus.min.js', TRANSFER), 'utf8');
    return route.fulfill({ body, contentType: TYPES.js });
  }
  const path = name.endsWith('.json') ? `locales/${name}` : ASSETS.get(name);
  if (!path || !/^[\w.-]+$/.test(name)) return route.fulfill({ status: 404 });
  return route.fulfill({ body: readFileSync(new URL(path, PHONE)), contentType: TYPES[name.split('.').pop() ?? ''] });
}

export type PhoneOptions = {
  theme: 'light' | 'dark';
  locale?: string;
  /** false: opened by typing the address (no QR token), so the setup code is asked for too. */
  token?: boolean;
  /** From the QR the page asks the computer to allow it; unless this is set, the phone chooses the PIN instead. */
  approve?: boolean;
  /** Scripts the stand-in computer before the page opens (its first ask comes at once). */
  prepare?: (mac: FakeMac) => void;
  tus?: 'real' | 'fake';
  reducedMotion?: 'reduce';
  forcedColors?: 'active';
};
export type Phone = { page: Page; mac: FakeMac; problems: string[]; close: () => Promise<void> };

export async function openPhone(browser: Browser, device: Device, options: PhoneOptions): Promise<Phone> {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    userAgent: device.userAgent,
    deviceScaleFactor: device.scale ?? 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: options.theme,
    locale: options.locale ?? 'en',
    reducedMotion: options.reducedMotion ?? 'no-preference',
    forcedColors: options.forcedColors ?? 'none',
  });
  const page = await context.newPage();
  const mac = new FakeMac();
  options.prepare?.(mac);
  const problems = await watchProblems(page);
  await serve(page, mac, options.tus ?? 'fake');
  await page.goto(`${ORIGIN}/${options.token === false ? '' : `#k=${QR_TOKEN}`}`);
  await expect(page.locator('#screen-pair')).toBeVisible();
  if (options.token !== false && !options.approve) await usePin(page);
  return { page, mac, problems, close: () => context.close() };
}

/** "Use the PIN instead": the request to the computer is withdrawn and the PIN boxes take its place. */
export async function usePin(page: Page): Promise<void> {
  await page.locator('#approval-pin').click();
  await expect(page.locator('#pair-form')).toBeVisible();
  await expect(page.locator('#approval')).toBeHidden();
}

/** Types into the PIN boxes from wherever the focus is, the way a thumb does. */
export async function typePin(page: Page, digits: string): Promise<void> {
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('digit')))) {
    await page.locator('#pin .digit').first().focus();
  }
  await page.keyboard.type(digits);
}

export async function pairPhone(page: Page): Promise<void> {
  await typePin(page, GOOD_PIN);
  await expect(page.locator('#screen-choose')).toBeVisible();
}

export async function pick(page: Page, device: Device, clips: readonly Clip[]): Promise<void> {
  const files = clips.map((clip) => ({ name: clip.name, mimeType: 'video/quicktime', buffer: Buffer.alloc(clip.size) }));
  await page.locator(device.picker).setInputFiles(files);
}

export const rows = (page: Page, list = '#send-list') => page.locator(`${list} > li`);
export const row = (page: Page, name: string, list = '#send-list') =>
  page.locator(`${list} > li`).filter({ has: page.locator('.row-name', { hasText: name }) });

/** Waits for finite animations to end (spinners turn for ever). */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
}

/** No sideways scroll, and every control a thumb can reach is at least 44 px each way. */
export async function expectPhoneFit(page: Page, label: string): Promise<void> {
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    small: [...document.querySelectorAll<HTMLElement>('button, a, label.pick, input:not([type=file]), summary')]
      .filter((el) => el.checkVisibility())
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 44 || box.width < 44)
      .map(({ el, box }) => `${el.id || el.className} ${Math.round(box.width)}×${Math.round(box.height)}`),
  }));
  expect(fit.scrollWidth, `${label}: page wider than the phone`).toBeLessThanOrEqual(fit.innerWidth);
  expect(fit.small, `${label}: targets under 44 px`).toEqual([]);
}

/** What the phone shows: the viewport only. */
export async function view(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/phone-${name}.png`, animations: 'disabled' });
}

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  // A phone has no pointer resting on a control: move the test's mouse off the page's controls.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/phone-${name}.png`, fullPage: true, animations: 'disabled' });
}

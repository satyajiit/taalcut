// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Content Security Policy of every app page, in one place: the desktop
 * app's app:// handler sends it as a header (apps/desktop), and `vite
 * preview` sends the same header so the renderer's e2e tests catch
 * violations before Electron does (apps/renderer).
 *
 * The brief's baseline plus three tightenings:
 * - worker-src 'self': named explicitly because frame-src/child-src are 'none'.
 * - frame-src: only render's preview player (app://preview); nothing else, not even the app itself.
 * - manifest-src 'none': no web app manifest in a desktop app.
 * For renderer code that rules out inline <script> and <style>, eval, fonts
 * from data: URLs (Vite must never inline assets), and requests to any other origin.
 *
 * Media the renderer shows comes from main's app://media host (derived files
 * by key, template assets by hash), never from a file path.
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/** The app:// host main serves derived files and template assets from. */
export const MEDIA_HOST = 'media';
const MEDIA_ORIGIN = `app://${MEDIA_HOST}`;
/** The app:// host of render's preview player, finished renders and posters (render's PREVIEW_ORIGIN). */
export const PREVIEW_HOST = 'preview';
const PREVIEW_ORIGIN = `app://${PREVIEW_HOST}`;

export const APP_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:', MEDIA_ORIGIN, PREVIEW_ORIGIN],
  'media-src': ["'self'", 'blob:', MEDIA_ORIGIN, PREVIEW_ORIGIN],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  /** Only the preview player's iframe. */
  'frame-src': [PREVIEW_ORIGIN],
  'manifest-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'none'"],
};

export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** The header value. */
export const APP_CSP = serializeCsp(APP_CSP_DIRECTIVES);

/**
 * Sent by main on every app://preview response: the player page runs its own bundled scripts, loads
 * proxies and fonts from its own origin, may be framed only by the app, and frames nothing.
 */
export const PREVIEW_CSP_DIRECTIVES: CspDirectives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:', MEDIA_ORIGIN],
  'media-src': ["'self'", 'blob:', MEDIA_ORIGIN],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ['app://taalcut'],
};

/** The packaged app's pages, the preview's only framer in a release build. */
const APP_PAGES = 'app://taalcut';

/** What may frame a preview: the app, or the Vite dev server on this Mac (http on a loopback host). */
const FRAME_ANCESTOR = /^(app:\/\/taalcut|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;

/**
 * The preview's policy for the pages that frame it. Main passes the dev server's origin in development, where
 * the window isn't app://taalcut. Anything else is dropped, so a bad value can only narrow the policy
 * (none left: `'none'`).
 */
export function previewCsp(options: { readonly frameAncestors?: readonly string[] } = {}): string {
  const ancestors = (options.frameAncestors ?? [APP_PAGES]).filter((origin) => FRAME_ANCESTOR.test(origin));
  return serializeCsp({
    ...PREVIEW_CSP_DIRECTIVES,
    'frame-ancestors': ancestors.length > 0 ? ancestors : ["'none'"],
  });
}

/** previewCsp() for the packaged app. */
export const PREVIEW_CSP = previewCsp();

/**
 * A derived file's URL in the renderer (analysis/media-facts.ts, DerivedFileRef). Main serves only keys
 * that match DERIVED_KEY_PATTERN, inside the media cache root, and touches the cache entry.
 */
export function mediaUrl(ref: { readonly key: string }): string {
  return `${MEDIA_ORIGIN}/${ref.key}`;
}

/** 'templates/<sha256>.<jpg|webp>': a template asset (a contact sheet) on the media host. */
export const TEMPLATE_ASSET_KEY_PATTERN = /^templates\/[0-9a-f]{64}\.(jpg|webp)$/;

/** A template asset's URL (contactSheetSchema). Main maps it through TemplateStore.assetPath. */
export function templateAssetUrl(asset: {
  readonly asset: string;
  readonly mediaType: 'image/jpeg' | 'image/webp';
}): string {
  return `${MEDIA_ORIGIN}/templates/${asset.asset}.${asset.mediaType === 'image/webp' ? 'webp' : 'jpg'}`;
}

/**
 * 'originals/<assetId>': a clip's original on the media host, for the clip page's viewer when media.proxy found it
 * small and plain enough to be its own proxy (UX2). Main serves it in byte ranges only while the library says so
 * and a copy of it is present on this Mac.
 */
export const ORIGINAL_MEDIA_KEY_PATTERN = /^originals\/[0-9A-HJKMNP-TV-Z]{26}$/;

/** The URL of a clip's original that is its own proxy (AssetDetail.playback, source 'original'). */
export function originalMediaUrl(assetId: string): string {
  return `${MEDIA_ORIGIN}/originals/${assetId}`;
}

/** 'device/<deviceKey>/<itemKey>.jpg': a USB device item's thumbnail, served from the lan process's cache (P3-B4). */
export const DEVICE_THUMB_KEY_PATTERN = /^device\/[A-Z2-7]{16}\/[A-Z2-7]{16}\.jpg$/;

/** A USB device item's thumbnail URL (transfer.deviceItems marks `thumb: true` when it is served). */
export function deviceThumbUrl(deviceKey: string, itemKey: string): string {
  return `${MEDIA_ORIGIN}/device/${deviceKey}/${itemKey}.jpg`;
}

/** 'styles/<sha256>.<png|jpg|webp>': a Style's logo (P3-V10). Main maps it through StyleStore.assetPath. */
export const STYLE_ASSET_KEY_PATTERN = /^styles\/[0-9a-f]{64}\.(png|jpg|webp)$/;

const STYLE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

/** A Style asset's URL (styleLogoSchema's `asset` and `mediaType`). */
export function styleAssetUrl(asset: {
  readonly asset: string;
  readonly mediaType: keyof typeof STYLE_EXTENSIONS;
}): string {
  return `${MEDIA_ORIGIN}/styles/${asset.asset}.${STYLE_EXTENSIONS[asset.mediaType]}`;
}

/** 'stock/<sha256>.<jpg|webp>': a stock result's preview, fetched by the agent process (the CSP loads no remote image). */
export const STOCK_PREVIEW_KEY_PATTERN = /^stock\/[0-9a-f]{64}\.(jpg|webp)$/;
/** The same preview as a full URL, as `stockResultSchema.preview` carries it. */
export const STOCK_PREVIEW_URL_PATTERN = /^app:\/\/media\/stock\/[0-9a-f]{64}\.(jpg|webp)$/;

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app:// scheme that serves the renderer build (checklist 18: a custom
 * protocol instead of file://). app://taalcut/ is a standard, secure origin,
 * so the same-origin policy, CSP 'self' and secure-context APIs all work.
 */
import { readFile } from 'node:fs/promises';
import { PREVIEW_CSP, PREVIEW_HOST } from '@taalcut/core';
import { protocol, type Protocol } from 'electron';
import { servePreview } from '../render/preview-protocol';
import { desktopPreviewRoots } from '../render/preview-roots';
import { APP_SCHEME } from '../runtime';
import { appResponseHeaders } from '../security/csp';
import { serveDeviceThumb } from './device-thumbs';
import type { ImportPreviewHandler } from './import-previews';
import { serveDerivedMedia } from './media-protocol';
import { serveOriginalMedia, type OriginalOf } from './original-media';
import { planAppRequest } from './resolve';
import { fileUnderRoot } from './root-file';
import { styleAssetHandler, templateAssetHandler } from './stored-assets';
import { serveTemplateReel, type ReelOf } from './template-reel';

/** Must run before app ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
        // app://preview streams video to <video> in byte ranges (render's preview player and renders).
        stream: true,
        // Not granted: bypassCSP, corsEnabled, allowServiceWorkers.
      },
    },
  ]);
}

export interface AppSchemeOptions {
  /** The media cache root: derived files on app://media/<key>. */
  readonly mediaRoot?: string;
  /** Device thumbnails: app://media/device/<deviceKey>/<itemKey>.jpg. */
  readonly deviceThumbs?: string;
  /** Lazy, local-only previews for persisted import selections, keyed by opaque item ids. */
  readonly importPreviews?: ImportPreviewHandler;
  /** The template store's folder: contact sheets on app://media/templates/<sha256>.<ext>. */
  readonly templateAssets?: string;
  /** The Style store's folder: logos on app://media/styles/<sha256>.<ext>. */
  readonly styleAssets?: string;
  /** The preview's CSP (previewCspFor: the dev server may frame it in development). */
  readonly previewCsp?: string;
  /** UX2: a clip's original that is its own proxy, on app://media/originals/<assetId> (original-media.ts). */
  readonly originals?: OriginalOf;
  /** BRK1: a template's kept reel, on app://media/template-reel/<templateId> (template-reel.ts). */
  readonly templateReels?: ReelOf;
}

/**
 * Serves the renderer under rootDir; derived files, template assets and Style logos when their folders are set.
 * Hosts `preview` and `media` are answered before the renderer planner, which 404s every other host.
 */
export function handleAppScheme(target: Protocol, rootDir: string, options: AppSchemeOptions = {}): void {
  const isFile = fileUnderRoot(rootDir);
  const templateAsset = options.templateAssets ? templateAssetHandler(options.templateAssets) : undefined;
  const styleAsset = options.styleAssets ? styleAssetHandler(options.styleAssets) : undefined;
  const csp = options.previewCsp ?? PREVIEW_CSP;
  target.handle(APP_SCHEME, async (request) => {
    // app://preview: render's player pages, proxies, renders and posters (packages/render SPEC 5).
    if (URL.canParse(request.url) && new URL(request.url).host === PREVIEW_HOST)
      return servePreview(request, desktopPreviewRoots(), undefined, csp);
    const asset = (await templateAsset?.(request)) ?? (await styleAsset?.(request));
    if (asset) return asset;
    const importPreview = await options.importPreviews?.(request);
    if (importPreview) return importPreview;
    if (options.deviceThumbs) {
      const thumb = await serveDeviceThumb(request, options.deviceThumbs);
      if (thumb) return thumb;
    }
    const original = options.originals ? serveOriginalMedia(request, options.originals) : undefined;
    if (original) return original;
    const reel = options.templateReels ? await serveTemplateReel(request, options.templateReels) : undefined;
    if (reel) return reel;
    if (options.mediaRoot) {
      const media = await serveDerivedMedia(request, options.mediaRoot);
      if (media) return media;
    }
    const plan = planAppRequest(request, rootDir, isFile);
    if (plan.kind === 'error') {
      return new Response(null, {
        status: plan.status,
        headers: appResponseHeaders('text/plain; charset=utf-8'),
      });
    }
    const body = request.method === 'HEAD' ? null : await readFile(plan.path);
    return new Response(body, { status: 200, headers: appResponseHeaders(plan.contentType) });
  });
}

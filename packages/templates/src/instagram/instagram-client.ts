// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Instagram Web API client for Saved Collections and Saved Reels, using the
 * same first-party Web REST endpoints (`/api/v1/collections/list/`,
 * `/api/v1/feed/saved/posts/`, `/api/v1/feed/collection/<id>/posts/`) as the
 * Instagram web app and `gallery-dl`.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  err,
  INSTAGRAM_COLLECTION_ID_REGEX,
  INSTAGRAM_SHORTCODE_REGEX,
  instagramAuthRequiredError,
  instagramFetchFailedError,
  instagramRateLimitedError,
  instagramSessionExpiredError,
  ok,
  type AsyncResult,
  type Clock,
  type InstagramCollectionUpsert,
  type InstagramSavedReelUpsert,
  type InstagramSessionProvider,
  type InstagramWebSession,
} from '@taalcut/core';

export const INSTAGRAM_WEB_APP_ID = '936619743392459';
const INSTAGRAM_API_BASE = 'https://www.instagram.com/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface InstagramClientDeps {
  readonly sessionProvider: InstagramSessionProvider;
  readonly clock: Clock;
  readonly fetch?: FetchLike;
  /** Maximum pages to pull per sync so a background sync stays polite. */
  readonly maxPagesPerSync?: number;
  /** True when the user enabled strict local-only mode. */
  readonly localOnly?: () => boolean;
}

export interface InstagramWebClient {
  fetchCollections(options?: { readonly signal?: AbortSignal }): AsyncResult<InstagramCollectionUpsert[]>;
  fetchCollectionReels(
    collectionId: string,
    options?: { readonly maxPages?: number; readonly signal?: AbortSignal },
  ): AsyncResult<InstagramSavedReelUpsert[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstCandidateUrl(media: Record<string, unknown> | null): string | null {
  if (!media) return null;
  const imageVersions = asRecord(media.image_versions2);
  const candidates = Array.isArray(imageVersions?.candidates) ? imageVersions.candidates : [];
  for (const candidate of candidates) {
    const rec = asRecord(candidate);
    if (typeof rec?.url === 'string' && rec.url.startsWith('https://')) {
      return rec.url;
    }
  }
  return null;
}

function parseCollectionItem(raw: unknown): InstagramCollectionUpsert | null {
  const item = asRecord(raw);
  if (!item) return null;
  const rawId = item.collection_id !== undefined ? String(item.collection_id).trim() : '';
  const type = typeof item.collection_type === 'string' ? item.collection_type : '';
  const id =
    type === 'ALL_MEDIA_AUTO_COLLECTION' || rawId === 'ALL_MEDIA_AUTO_COLLECTION'
      ? ALL_SAVED_COLLECTION_ID
      : rawId;
  if (!id || !INSTAGRAM_COLLECTION_ID_REGEX.test(id)) return null;
  const rawName = typeof item.collection_name === 'string' ? item.collection_name.trim() : '';
  const name = rawName || (id === ALL_SAVED_COLLECTION_ID ? 'All saved' : 'Saved collection');
  const mediaCount =
    typeof item.collection_media_count === 'number' && item.collection_media_count >= 0
      ? Math.floor(item.collection_media_count)
      : 0;
  const coverMedia = asRecord(item.cover_media);
  const coverUrl = firstCandidateUrl(coverMedia);
  return {
    id,
    name: name.slice(0, 200),
    mediaCount,
    coverUrl,
  };
}

function isVideoOrReel(media: Record<string, unknown>): boolean {
  if (media.media_type === 2) return true;
  if (media.product_type === 'clips' || media.product_type === 'igtv') return true;
  if (Array.isArray(media.video_versions) && media.video_versions.length > 0) return true;
  if (typeof media.video_duration === 'number' && media.video_duration > 0) return true;
  return false;
}

function parseSavedReelItem(
  raw: unknown,
  collectionId: string,
  orderSavedAt: number,
): InstagramSavedReelUpsert | null {
  if (!INSTAGRAM_COLLECTION_ID_REGEX.test(collectionId)) return null;
  const wrapper = asRecord(raw);
  const media = asRecord(wrapper?.media) ?? wrapper;
  if (!media) return null;

  // Carousel posts may contain a video item; otherwise check the media itself.
  const carousel = Array.isArray(media.carousel_media) ? media.carousel_media : [];
  const videoCarouselItem = carousel.map(asRecord).find((entry) => entry !== null && isVideoOrReel(entry));
  if (!isVideoOrReel(media) && !videoCarouselItem) return null;

  const shortcode = typeof media.code === 'string' ? media.code.trim() : '';
  if (!shortcode || !INSTAGRAM_SHORTCODE_REGEX.test(shortcode)) return null;

  const rawPk = media.pk ?? media.id ?? shortcode;
  const mediaPk = String(rawPk).slice(0, 80);
  const captionObj = asRecord(media.caption);
  const caption =
    typeof captionObj?.text === 'string' && captionObj.text.trim()
      ? captionObj.text.trim().slice(0, 4000)
      : null;
  const userObj = asRecord(media.user);
  const authorHandle =
    typeof userObj?.username === 'string' && userObj.username.trim()
      ? userObj.username.trim().slice(0, 120)
      : null;
  const durationSec =
    typeof media.video_duration === 'number'
      ? media.video_duration
      : typeof videoCarouselItem?.video_duration === 'number'
        ? videoCarouselItem.video_duration
        : null;
  const durationMs =
    durationSec !== null && Number.isFinite(durationSec) && durationSec > 0
      ? Math.round(durationSec * 1000)
      : null;
  const thumbnailUrl = firstCandidateUrl(media) ?? firstCandidateUrl(videoCarouselItem ?? null);

  return {
    shortcode,
    mediaPk,
    collectionId,
    permalink: `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/`,
    caption,
    authorHandle,
    durationMs,
    thumbnailUrl,
    // Instagram's saved feed returns items in reverse-chronological save order;
    // `orderSavedAt` preserves save order rather than the creator's publish date (`taken_at`).
    savedAt: orderSavedAt,
  };
}

export function createInstagramWebClient(deps: InstagramClientDeps): InstagramWebClient {
  const fetchFn: FetchLike = deps.fetch ?? globalThis.fetch;
  const defaultMaxPages = deps.maxPagesPerSync ?? 3;

  async function requestJson(
    session: InstagramWebSession,
    pathWithQuery: string,
    signal?: AbortSignal,
  ): AsyncResult<Record<string, unknown>> {
    if (deps.localOnly?.()) {
      return err(instagramFetchFailedError(undefined, { detail: 'local-only mode enabled' }));
    }
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await fetchFn(`${INSTAGRAM_API_BASE}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          accept: '*/*',
          'x-ig-app-id': INSTAGRAM_WEB_APP_ID,
          'x-requested-with': 'XMLHttpRequest',
          referer: 'https://www.instagram.com/',
          ...session.headers,
        },
        redirect: 'manual',
        signal: combinedSignal,
      });
    } catch (cause) {
      return err(instagramFetchFailedError(undefined, { detail: String(cause).slice(0, 300) }));
    }

    if (response.status === 429) {
      return err(instagramRateLimitedError());
    }
    if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
      await deps.sessionProvider.invalidate();
      return err(instagramSessionExpiredError());
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      return err(
        instagramFetchFailedError(undefined, {
          detail: `HTTP ${response.status}: non-JSON response (${String(cause).slice(0, 120)})`,
        }),
      );
    }

    const record = asRecord(body);
    if (!record) {
      return err(instagramFetchFailedError(undefined, { detail: `HTTP ${response.status}: empty object` }));
    }
    const message = typeof record.message === 'string' ? record.message : '';
    if (message === 'login_required' || message === 'checkpoint_required' || record.require_login === true) {
      await deps.sessionProvider.invalidate();
      return err(instagramSessionExpiredError(undefined, { detail: message || 'login_required' }));
    }
    if (!response.ok) {
      return err(
        instagramFetchFailedError(undefined, {
          detail: `HTTP ${response.status}: ${message.slice(0, 200)}`,
        }),
      );
    }
    return ok(record);
  }

  return {
    async fetchCollections(options) {
      const session = await deps.sessionProvider.getSession();
      if (!session.ok) return session;
      if (!session.value) return err(instagramAuthRequiredError());

      const query = encodeURIComponent(JSON.stringify(['ALL_MEDIA_AUTO_COLLECTION', 'MEDIA']));
      const res = await requestJson(
        session.value,
        `/collections/list/?collection_types=${query}`,
        options?.signal,
      );
      if (!res.ok) return res;

      const rawItems = Array.isArray(res.value.items) ? res.value.items : [];
      const parsed: InstagramCollectionUpsert[] = [];
      for (const raw of rawItems) {
        const item = parseCollectionItem(raw);
        if (item) parsed.push(item);
      }
      if (!parsed.some((c) => c.id === ALL_SAVED_COLLECTION_ID)) {
        parsed.unshift({
          id: ALL_SAVED_COLLECTION_ID,
          name: 'All saved',
          mediaCount: 0,
          coverUrl: null,
        });
      }
      return ok(parsed);
    },

    async fetchCollectionReels(collectionId, options) {
      if (!INSTAGRAM_COLLECTION_ID_REGEX.test(collectionId)) {
        return err(instagramFetchFailedError(undefined, { detail: 'invalid collectionId' }));
      }
      const session = await deps.sessionProvider.getSession();
      if (!session.ok) return session;
      if (!session.value) return err(instagramAuthRequiredError());

      const maxPages = Math.max(1, options?.maxPages ?? defaultMaxPages);
      const basePath =
        collectionId === ALL_SAVED_COLLECTION_ID
          ? '/feed/saved/posts/'
          : `/feed/collection/${encodeURIComponent(collectionId)}/posts/`;

      const reels: InstagramSavedReelUpsert[] = [];
      let maxId: string | null = null;
      let orderTick = deps.clock.now();

      for (let page = 0; page < maxPages; page++) {
        const pathWithQuery = maxId ? `${basePath}?max_id=${encodeURIComponent(maxId)}` : basePath;
        const res = await requestJson(session.value, pathWithQuery, options?.signal);
        if (!res.ok) return res;

        const items = Array.isArray(res.value.items) ? res.value.items : [];
        for (const raw of items) {
          const parsed = parseSavedReelItem(raw, collectionId, orderTick--);
          if (parsed) reels.push(parsed);
        }

        const moreAvailable = res.value.more_available === true;
        const nextMaxId = typeof res.value.next_max_id === 'string' ? res.value.next_max_id : null;
        if (!moreAvailable || !nextMaxId) break;
        maxId = nextMaxId;
      }

      return ok(reels);
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved on Instagram's data, shared by its collection pages and its settings (UX4 tpl): the sign-in status, the
 * collections (All Saved first, always), one collection's reels page by page (none for settings: a null
 * collection), and signing in and out. Any template or Saved command reads it all again. A collection never synced
 * is synced once, when its page opens.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  callRpc,
  INSTAGRAM_PROVIDER,
  INSTAGRAM_SAVED_COMMANDS,
  type InstagramCollection,
  type InstagramSavedReel,
  type TaalcutError,
} from '@taalcut/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { reelsQueryOf, type SavedSearch } from './saved-search';

/** All Saved before the first sync names it: the backend's own row replaces it once it exists. */
const FALLBACK_ALL_SAVED: InstagramCollection = {
  id: ALL_SAVED_COLLECTION_ID,
  name: 'All Saved',
  mediaCount: 0,
  coverUrl: null,
  watched: false,
  autoBreakdown: false,
  lastSyncedAt: null,
  updatedAt: 0,
};

const NO_REELS = { items: [] as InstagramSavedReel[], nextCursor: null as string | null };

export function useSaved(collectionId: string | null, search: SavedSearch) {
  const backend = useBackend();
  const [round, bump] = useReducer((n: number) => n + 1, 0);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState<TaalcutError | null>(null);
  const [more, setMore] = useState<{ items: InstagramSavedReel[]; cursor: string | null | undefined }>({
    items: [],
    cursor: undefined,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const synced = useRef<Set<string>>(new Set());
  const query = useMemo(
    () => (collectionId === null ? null : reelsQueryOf(collectionId, search)),
    [collectionId, search],
  );
  const queryKey = JSON.stringify(query);

  useEffect(() => setMore({ items: [], cursor: undefined }), [queryKey, round]);

  const state = useRpcQuery(
    async (signal) => {
      const status = await backend.templates.instagramStatus(undefined, { signal });
      if (!status.signedIn) return { status, collections: [] as InstagramCollection[], reels: NO_REELS };
      const [collections, reels] = await Promise.all([
        backend.templates.instagramCollections(undefined, { signal }),
        query ? backend.templates.instagramReels(query, { signal }) : NO_REELS,
      ]);
      return { status, collections, reels };
    },
    [backend, round, queryKey],
  );

  useBackendEvents(['library.changed', 'command.changed'], (event) => {
    if (event.type === 'library.changed' && event.payload.entity === 'template') bump();
    else if (
      event.type === 'command.changed' &&
      (event.payload.name.startsWith('instagramSaved.') || event.payload.name.startsWith('template.'))
    )
      bump();
  });

  const collections = useMemo(() => {
    const list = state.data?.collections ?? [];
    return list.some((c) => c.id === ALL_SAVED_COLLECTION_ID) ? list : [FALLBACK_ALL_SAVED, ...list];
  }, [state.data?.collections]);
  const active = collections.find((c) => c.id === collectionId) ?? null;
  const signedIn = state.data?.status.signedIn ?? false;

  // A collection never synced is read once, the first time its page opens.
  useEffect(() => {
    if (!signedIn || !active || active.lastSyncedAt !== null || synced.current.has(active.id)) return;
    synced.current.add(active.id);
    void callRpc(
      backend.commands.dispatch({
        name: INSTAGRAM_SAVED_COMMANDS.syncCollection,
        payload: { projectId: null, collectionId: active.id },
        source: 'ui',
      }),
    ).then((res) => {
      if (res.ok) bump();
    });
  }, [signedIn, active, backend]);

  const items = useMemo(() => {
    const base = state.data?.reels.items ?? [];
    if (more.items.length === 0) return base;
    const seen = new Set(base.map((r) => r.shortcode));
    return [...base, ...more.items.filter((r) => !seen.has(r.shortcode))];
  }, [state.data?.reels.items, more.items]);
  const nextCursor = more.cursor !== undefined ? more.cursor : (state.data?.reels.nextCursor ?? null);

  const loadMore = async () => {
    if (!query || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await callRpc(backend.templates.instagramReels({ ...query, cursor: nextCursor }));
    setLoadingMore(false);
    if (res.ok)
      setMore((prev) => ({ items: [...prev.items, ...res.value.items], cursor: res.value.nextCursor }));
  };

  const signIn = async (acknowledgedAt: number) => {
    setSigningIn(true);
    setAuthError(null);
    const res = await callRpc(backend.accounts.signIn({ provider: INSTAGRAM_PROVIDER, acknowledgedAt }));
    if (!res.ok) {
      setSigningIn(false);
      setAuthError(res.error);
      return;
    }
    await callRpc(
      backend.commands.dispatch({
        name: INSTAGRAM_SAVED_COMMANDS.syncCollection,
        payload: { projectId: null },
        source: 'ui',
      }),
    );
    setSigningIn(false);
    bump();
  };

  const signOut = async () => {
    setSigningOut(true);
    setAuthError(null);
    await callRpc(backend.accounts.signOut({ provider: INSTAGRAM_PROVIDER }));
    setSigningOut(false);
    synced.current.clear();
    bump();
  };

  return {
    state,
    signedIn,
    username: state.data?.status.username ?? null,
    collections,
    active,
    items,
    nextCursor,
    loadingMore,
    loadMore,
    signIn,
    signOut,
    signingIn,
    signingOut,
    authError,
    setAuthError,
    reload: bump,
  };
}

export type Saved = ReturnType<typeof useSaved>;

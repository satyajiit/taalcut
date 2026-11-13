// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words for errors Settings shows that no other catalogue names: adding or
 * reading a folder (@taalcut/library's sources errors) and External agents'
 * server (@taalcut/tools' mcp errors). Explicit ids: the backend sends
 * `errors.<code>` and the kit's errorMessage reads them from the catalogue, so
 * each says its cause and what to do instead of "Something went wrong" (UX1, M24).
 * `name` is the folder's name, never its path.
 */
import { msg } from '@lingui/core/macro';
import { PLUGIN_ERROR_MESSAGES } from './plugins/plugin-errors';

export const SETTINGS_ERROR_MESSAGES = [
  ...PLUGIN_ERROR_MESSAGES,
  msg({
    id: 'errors.library.folder_missing',
    message: 'The {name} folder isn’t on this Mac any more. If you moved it, choose it again.',
  }),
  msg({
    id: 'errors.library.not_a_folder',
    message: '{name} is a file, not a folder. Choose the folder it’s in.',
  }),
  msg({
    id: 'errors.library.folder_not_allowed',
    message:
      'Taalcut can’t watch {name}: it’s the whole disk or Taalcut’s own folder. Choose the folder your videos are in.',
  }),
  msg({
    id: 'errors.library.folder_permission_denied',
    message: 'macOS isn’t letting Taalcut read {name}. Allow it in Files and Folders, then check it again.',
  }),
  msg({
    id: 'errors.library.too_many_sources',
    message: 'Taalcut can watch up to {limit} folders. Remove one you don’t use, then add this one.',
  }),
  msg({
    id: 'errors.mcp.port_in_use',
    message:
      'Another app is using port {port}, so agents can’t reach Taalcut. Quit that app, then try again.',
  }),
  msg({
    id: 'errors.mcp.bind_failed',
    message:
      'This Mac didn’t let Taalcut listen on port {port}. Try again, or restart your Mac if it keeps happening.',
  }),
  // FIX-ERRWORDS: a connection whose key is gone from where Taalcut keeps keys (its fix makes a new key).
  msg({
    id: 'errors.desktop.mcp_token_missing',
    message: 'This connection’s key is gone, so its setup can’t be copied again. Make a new key for it.',
  }),
  msg({
    id: 'templates.warning.instagram.title',
    message: 'Using your Instagram Saved collections in Taalcut',
  }),
  msg({
    id: 'templates.warning.instagram.body',
    message:
      'Taalcut signs in through an Instagram browser window on this Mac and reads your Saved collections with your browser session. Your session stays in your Mac’s Keychain and is never sent anywhere else.',
  }),
  msg({
    id: 'templates.warning.instagram.risk',
    message:
      'Instagram hasn’t approved other apps reading Saved collections this way, and could ask you to sign in again or limit your account. Pasting a public Reel link avoids signing in.',
  }),
  msg({
    id: 'errors.templates.instagram_auth_required',
    message: 'Sign in to Instagram first, then try again.',
  }),
  msg({
    id: 'errors.templates.instagram_session_expired',
    message: 'Your Instagram sign-in expired. Sign in again to read your Saved collections.',
  }),
  msg({
    id: 'errors.templates.instagram_rate_limited',
    message: 'Instagram asked Taalcut to wait before reading more Saved reels. Try again in a few minutes.',
  }),
  msg({
    id: 'errors.templates.instagram_fetch_failed',
    message: 'Couldn’t read your Saved reels from Instagram. Check your connection, then try again.',
  }),
  msg({
    id: 'errors.templates.instagram_collection_not_found',
    message: 'That Saved collection isn’t in Taalcut yet. Sync your collections, then try again.',
  }),
] as const;

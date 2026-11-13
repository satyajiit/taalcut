// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the project's chat sends "Send N comments to Taalcut" as one message with the comments' ids
 * (`MessageExtras.comments`), once it has loaded and no run is going; a request made meanwhile waits.
 */
import type { MessageExtras } from '../../../chat/use-conversation';
import { commentSendRequests, useClaim } from './comment-requests';

export function useCommentSends(
  send: (text: string, reasoning?: undefined, extras?: MessageExtras) => void,
  ready: boolean,
): void {
  useClaim(commentSendRequests, ({ ids, text }) => send(text, undefined, { comments: ids }), ready);
}

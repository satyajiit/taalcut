// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: a pin, the viewer's marker or the inspector pointing at a comment opens the dock on Comments; "Send N
 * comments to Taalcut" shows the chat that works on them (the chat itself claims the send: use-comment-sends.ts).
 */
import { useEffect, useRef } from 'react';
import { commentSendRequests, showCommentRequests, useClaim, useLatest } from './comment-requests';

export function useCommentsDock(open: (panel: 'comments' | 'chat') => void): void {
  useClaim(showCommentRequests, () => open('comments'));
  const sent = useLatest(commentSendRequests)?.tick ?? 0;
  const seen = useRef(sent);
  useEffect(() => {
    if (sent > seen.current) open('chat');
    seen.current = sent;
  }, [sent, open]);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Comments on a timeline (EDT1-CMT): the store, its commands, and how comments follow their anchors. */
export { createCommentStore, type CommentStoreOptions } from './comment-store';
export { createCommentCommands, type CommentCommandDeps, type CommentCommands } from './comment-commands';
export { followComments, type TimelineChange } from './comment-follow';
export { timelineComments, type CommentRow } from './comment-table';
export { createCommentsService, type CommentsServiceDeps } from './comments-service';
export { commentToolModule, type CommentToolDeps } from './comment-tools';
export { createCommentBatches, type CommentBatchDeps } from './comment-batches';

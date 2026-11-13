// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ClipPage } from '../../../features/library/clip/clip-page';
import { ClipPending } from '../../../features/library/clip/clip-pending';
import { routeId } from '../../../shell/route-id';

// Main reads this path to know which clip a window shows, and keeps that clip's files in the media cache while it does
// (apps/desktop src/main/open-clips.ts): a new path for the clip page moves there too.
export const Route = createFileRoute('/_shell/library/$assetId')({
  params: {
    parse: ({ assetId }) => ({ assetId: routeId<'Asset'>(assetId) }),
    stringify: ({ assetId }) => ({ assetId }),
  },
  component: Clip,
  // The page's bones are its pending view, kept out of the split chunk and shown at once, so a clip opens to its
  // own shape within 100 ms while its code and its data arrive (PRD R32, skeleton.spec.ts).
  pendingComponent: ClipPending,
  pendingMs: 0,
  pendingMinMs: 0,
  codeSplitGroupings: [['component'], ['errorComponent'], ['notFoundComponent']],
});

function Clip() {
  const { assetId } = Route.useParams();
  // Another clip is another page: nothing of the last one (its data, its playhead) carries over.
  return <ClipPage key={assetId} assetId={assetId} />;
}

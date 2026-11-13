// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';
import { routeId } from '../../../../shell/route-id';

/** A hub template's old address (P3-B12): it is a community template under Start from… now (UX4 tpl). */
export const Route = createFileRoute('/_shell/templates/hub/$hubId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/templates/start/community/$hubId',
      params: { hubId: routeId<'HubTemplate'>(params.hubId) },
      replace: true,
    });
  },
});

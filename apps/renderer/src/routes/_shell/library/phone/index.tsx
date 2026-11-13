// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/library/phone/')({
  beforeLoad: () => {
    throw redirect({ to: '/library/import/$method', params: { method: 'phone-wifi' }, replace: true });
  },
});

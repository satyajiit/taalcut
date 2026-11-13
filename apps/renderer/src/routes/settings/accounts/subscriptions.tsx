// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { SubscriptionsSettings } from '../../../features/settings/accounts/accounts-manage';

/** Accounts › Subscriptions: ChatGPT and the plans; `?warning=` (the layout's) opens that plan's warning card. */
export const Route = createFileRoute('/settings/accounts/subscriptions')({
  component: Subscriptions,
});

function Subscriptions() {
  const { warning } = Route.useSearch();
  return <SubscriptionsSettings openWarning={warning} />;
}

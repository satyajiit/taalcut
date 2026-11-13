// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The browser side of Kaatu's fixture: hydrates the server HTML test/e2e/kaatu.spec.ts rendered from KaatuFixture. */
import { hydrateRoot } from 'react-dom/client';
import { KaatuFixture } from './kaatu';

const root = document.getElementById('fixture');
if (root) {
  hydrateRoot(root, <KaatuFixture />);
  document.documentElement.dataset.hydrated = '';
}

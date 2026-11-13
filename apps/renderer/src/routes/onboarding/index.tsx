// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { Welcome } from '../../onboarding/welcome';

export const Route = createFileRoute('/onboarding/')({
  component: Welcome,
});

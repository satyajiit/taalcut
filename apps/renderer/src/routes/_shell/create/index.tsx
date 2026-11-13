// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { CreatePage } from '../../../features/create/create-page';
export const Route = createFileRoute('/_shell/create/')({
  staticData: { crumb: msg`Create` },
  component: CreatePage,
});

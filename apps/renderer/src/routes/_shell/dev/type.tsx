// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TypeSpecimenPage } from '../../../features/type-specimen/type-specimen-page';

/** The type reference: roles, scripts and families (DESIGN.md, Typography). */
export const Route = createFileRoute('/_shell/dev/type')({
  component: TypeSpecimenPage,
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardActions } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';
import type { Backend } from '../backend/backend';
import { hubCardActions } from '../features/templates/hub/hub-card-actions';
import { stockCardActions } from '../features/timeline/gaps/stock-actions';

/** What Phase 3's cards' buttons do (packages/ui CardActions), each from its own area. */
export function phase3CardActions(
  backend: Backend,
  navigate: ReturnType<typeof useNavigate>,
): Partial<CardActions> {
  return { ...hubCardActions(backend, navigate), ...stockCardActions(backend) };
}

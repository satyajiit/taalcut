// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { AiMarkIcon } from '@taalcut/ui';
import {
  AudioWaveform,
  Clapperboard,
  Film,
  Flame,
  FolderOpen,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

export type AreaId = 'make' | 'create' | 'insights' | 'products' | 'library' | 'templates' | 'agent';

export interface Area {
  id: AreaId;
  label: MessageDescriptor;
  icon: LucideIcon;
  to: '/projects' | '/create' | '/insights' | '/products' | '/library' | '/templates' | '/chat';
  /** Path prefixes that belong to the area, for the sidebar's "you are here". */
  paths: readonly string[];
  /** The area's meaning colour (DESIGN.md), written out so Tailwind sees it. */
  iconClass: string;
}

/**
 * The areas, each with its accent's job: Create and Make are marigold (act), Insights
 * and Templates rose (rhythm & trends), Library teal (your footage), Agent violet (the AI). Every
 * area shows an icon and a word, so colour is never the only signal.
 * Make opens the project list (P2-X3); its exports are a page of it.
 */
export const AREAS: readonly Area[] = [
  {
    id: 'products',
    label: msg`Products`,
    icon: FolderOpen,
    to: '/products',
    paths: ['/products'],
    iconClass: 'text-area-library-strong',
  },
  {
    id: 'create',
    label: msg`Create`,
    icon: WandSparkles,
    to: '/create',
    paths: ['/create'],
    iconClass: 'text-area-make-strong',
  },
  {
    id: 'make',
    label: msg`Make`,
    icon: Clapperboard,
    to: '/projects',
    paths: ['/projects', '/renders'],
    iconClass: 'text-area-make-strong',
  },
  {
    id: 'insights',
    label: msg`Insights`,
    icon: Flame,
    to: '/insights',
    paths: ['/insights'],
    iconClass: 'text-area-templates-strong',
  },
  {
    id: 'library',
    label: msg`Library`,
    icon: Film,
    to: '/library',
    paths: ['/library'],
    iconClass: 'text-area-library-strong',
  },
  {
    id: 'templates',
    label: msg`Templates`,
    icon: AudioWaveform,
    to: '/templates',
    paths: ['/templates'],
    iconClass: 'text-area-templates-strong',
  },
  {
    id: 'agent',
    label: msg`Agent`,
    icon: AiMarkIcon,
    to: '/chat',
    paths: ['/chat'],
    iconClass: 'text-area-agent-strong',
  },
];

export function isUnder(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

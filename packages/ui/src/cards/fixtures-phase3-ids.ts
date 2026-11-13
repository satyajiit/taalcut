// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Id, RationalTime } from '@taalcut/core';

/** Shared ids and helpers for Phase 3's card fixtures (each area's fixtures file imports them). */
export const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>;
export const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>;
export const TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>;
export const VARIANT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZC' as Id<'Timeline'>;
export const GAP = '01K7C5M6Q8R9S0T1V2W3X4Y5ZD' as Id<'TimelineItem'>;
export const SLOT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZE' as Id<'TemplateSlot'>;
export const ASSET = '01K7C5M6Q8R9S0T1V2W3X4Y5ZH' as Id<'Asset'>;
export const ASSET_2 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZJ' as Id<'Asset'>;
export const BATCH = '01K7C5M6Q8R9S0T1V2W3X4Y5ZK' as Id<'RenderBatch'>;
export const RENDER = '01K7C5M6Q8R9S0T1V2W3X4Y5ZM' as Id<'Render'>;
export const T0 = 1_760_000_000_000;
export const usd = (micros: number) => ({ currency: 'USD', micros });
export const at = (frames: number): RationalTime => ({ value: frames, rate: { num: 30, den: 1 } });

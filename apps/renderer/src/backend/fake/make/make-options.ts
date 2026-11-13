// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FakeSystem } from '../fake-system';

/** The Make fakes' options (fake-make.ts), on their own so the Phase 3 fakes and the option readers can name them. */
export interface FakeMakeOptions {
  /** LNX1-AV1: the machine, for the codecs its exports can be in (FAKE_VIDEO_CODECS). Default the Mac. */
  readonly system?: FakeSystem;
  /** Milliseconds every read waits, to see skeletons. */
  readonly latencyMs?: number;
  /** Milliseconds between a render's progress ticks; 0 holds every render still (tests). Default 600. */
  readonly renderTickMs?: number;
  /** The fake library's size, so picks name clips it has. */
  readonly libraryCount?: number;
  /** No projects at all (the empty Make page). */
  readonly empty?: boolean;
  /**
   * Phase 3 areas' own scenario options, by area (`gaps`, `cleanup`, `variants`…), as their options/<area>.ts
   * readers parsed them from `taalcut.fake`; each area's seed and fake read only their own key.
   */
  readonly areas?: Readonly<Record<string, unknown>>;
}

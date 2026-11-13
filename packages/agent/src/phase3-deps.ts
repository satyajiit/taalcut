// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Phase 3's features plug into a run (SPEC sections 21–29): each is optional, so an agent composed
 * without one runs exactly as in Phase 2. Every feature adds its own field here, typed by a port declared in
 * its own folder; the loop reaches them through `RunContext.phase3`.
 */
import type { SoulDials } from '@taalcut/core';
import type { FlowExtensionDeps } from './flows/extensions';
import type { LocalOnlyDeps } from './local-only/local-only';
import type { MemoryRecallDeps } from './memory/memory-port';
import type { RateLimitDeps } from './limits/limit-port';
import type { RouteAdvisor } from './router/router-port';
import type { PointerResolver } from './timestamps/pointers';
import type { EditorResolver } from './editor/editor-port';

export interface Phase3Deps {
  /**
   * Soul v1 (P3-B15): the dials (core's SOUL_DIALS_SETTING) in effect when a run starts. Read once per run and
   * logged in run.started, so the run's prompt never changes mid-run and resume and replay build the same one.
   */
  readonly soulDials?: () => Promise<SoulDials>;
  /**
   * Reference timestamps (P3-V15): what a message points at ("the transition at 0:04", "slot 3"), resolved
   * once at the start against the conversation's template and timeline (createPointerResolver).
   */
  readonly pointers?: PointerResolver;
  /**
   * Flow extensions (SPEC section 25): optional steps anchored to flow steps (gaps after the Librarian, the
   * voice steps), composed with composeFlowExtensions.
   */
  readonly flowExtensions?: FlowExtensionDeps;
  /**
   * G8: the usage limits models' tracker keeps (createUsageLimitsTracker), so a rateLimit card leaves out the
   * module's other models that are limited too. Without it the card offers every configured option.
   */
  readonly limits?: RateLimitDeps;
  /**
   * Router (P3-B11): which tool family next, or none (createRouteAdvisor over models' Classifier). Its mode is
   * read when a run starts (off, shadow or on) and logged; replay answers from the log, never the router.
   */
  readonly router?: RouteAdvisor;
  /**
   * Local only (P3-B10): the switch as it is now (a run logs it in run.started.localOnly) and which modules run
   * on this Mac, so a cloud-module tool runs there without an upload consent and anything else online is refused.
   */
  readonly localOnly?: LocalOnlyDeps;
  /**
   * Agent memory (LRN1-MEM, SPEC section 33): the items recalled for the run's scopes and message, read once at the
   * start and logged in run.started, under the cloud switch and Local only.
   */
  readonly memory?: MemoryRecallDeps;
  /**
   * EDT1-CTX (SPEC section 38): the editor a docked message was sent from. Its brief (the timeline as numbered on
   * screen, the selection, the playhead, what the words point at) is read once at the start, logged in run.started
   * and ends every system prompt of the run; the timeline is read again at the end for the changes card.
   */
  readonly editor?: EditorResolver;
}

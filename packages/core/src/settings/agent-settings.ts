// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's settings (P3-B15, P3-B11): the soul dials (tone and verbosity) and the tool router's rollout.
 * Changed with AGENT_SETTING_COMMANDS (handlers: @taalcut/agent), app-wide. The router is off by default; 'live'
 * for a family counts only while a passing router report is recorded in `gate`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineSetting } from '../ports/preferences';

/** Stops 0 to 4. Tone: playful to professional. Verbosity: just do it to teach me. */
export const soulDialsSchema = z.object({ tone: z.int().min(0).max(4), verbosity: z.int().min(0).max(4) });
export type SoulDials = z.output<typeof soulDialsSchema>;
export const SOUL_DIALS_SETTING = defineSetting('agent.soulDials', soulDialsSchema, {
  tone: 2,
  verbosity: 1,
});

export const ROUTER_MODES = ['off', 'shadow', 'on'] as const;
export type RouterMode = (typeof ROUTER_MODES)[number];
export const ROUTER_FAMILY_STATES = ['off', 'shadow', 'live'] as const;

export const routerSettingSchema = z.object({
  mode: z.enum(ROUTER_MODES),
  /** Tool family id to state; a family missing here is 'shadow'. */
  families: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), z.enum(ROUTER_FAMILY_STATES)),
  noneLive: z.boolean(),
  /** Set from a passing router report. */
  gate: z.object({ passedAt: z.int().nonnegative(), reportId: z.string().min(1).max(64) }).nullable(),
});
export type RouterSetting = z.output<typeof routerSettingSchema>;
export const ROUTER_SETTING = defineSetting('agent.router', routerSettingSchema, {
  mode: 'off',
  families: {},
  noneLive: false,
  gate: null,
});

export const AGENT_SETTING_COMMANDS = {
  /** write; inverse itself with the previous dials; the agent only when asked. */
  setSoulDials: 'agent.setSoulDials',
  /** write; inverse itself; person sources only. */
  setRouter: 'agent.setRouter',
} as const;

const nonEmpty = { message: 'Nothing to change' };
const appWide = { projectId: z.null().default(null) };

export const agentSettingCommandPayloads = {
  [AGENT_SETTING_COMMANDS.setSoulDials]: soulDialsSchema
    .partial()
    .extend(appWide)
    .refine(({ tone, verbosity }) => tone !== undefined || verbosity !== undefined, nonEmpty),
  [AGENT_SETTING_COMMANDS.setRouter]: routerSettingSchema
    .partial()
    .extend(appWide)
    .refine(
      ({ mode, families, noneLive, gate }) =>
        mode !== undefined || families !== undefined || noneLive !== undefined || gate !== undefined,
      nonEmpty,
    ),
};

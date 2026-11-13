// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app-wide cap on hardware video sessions (media's HardwareSessionGate):
 * the jobs process (media, vision and sandbox FFmpeg) and the render process
 * (conform, previews, QA and the producer's encode) wait on one folder. It
 * is per user, not per userData, so every Taalcut of this user (another
 * update channel, a development build) shares it: there is one video engine.
 * Media places it (`hardwareSessionFolder`: the per-user temp folder on a Mac,
 * `$XDG_RUNTIME_DIR` on Linux, never a /tmp folder another user can reach) and
 * makes it 0700. The limit comes from the video engine and tier, probed at the first acquire.
 */
import { createToken, type Container } from '@taalcut/core';
import {
  createHardwareSessionGate,
  hardwareSessionContext,
  hardwareSessionLimit,
  type HardwareSessionGate,
  type MediaContext,
} from '@taalcut/media';
import { hardwareVideoEngine } from '@taalcut/models';
import { hostPlatform } from '../../platform';
import type { ProbedHardware } from '../../shared/tokens';
import { macHardware } from './hardware';

export const HardwareSessionsToken = createToken<HardwareSessionGate>('desktop.hardwareSessions');

export const hardwareSessionDir = (): string => hostPlatform().hardwareSessionDir();

export function appHardwareSessions(
  hardware: () => Promise<ProbedHardware>,
  dir: string = hardwareSessionDir(),
): HardwareSessionGate {
  return createHardwareSessionGate({
    dir,
    limit: async () =>
      hardwareSessionLimit(
        await hardware().then(
          (probed) => ({ engine: hardwareVideoEngine(probed.info), tier: probed.assessment.tier }),
          () => undefined,
        ),
      ),
    log: (line) => console.warn(`[media] ${line}`),
  });
}

/** Registers the gate once per process (lazily: nothing is probed or created until FFmpeg needs a slot). */
export function registerHardwareSessions(
  container: Container,
  userData: string,
  hardware: () => Promise<ProbedHardware> = macHardware(userData),
): HardwareSessionGate {
  if (!container.has(HardwareSessionsToken))
    container.value(HardwareSessionsToken, appHardwareSessions(hardware));
  return container.resolve(HardwareSessionsToken);
}

/** The MediaContext fields that apply the cap, or none in a container without it (tests). */
export function sessionContext(container: Container): Pick<MediaContext, 'runner' | 'hardwareSessions'> {
  return container.has(HardwareSessionsToken)
    ? hardwareSessionContext(container.resolve(HardwareSessionsToken))
    : {};
}

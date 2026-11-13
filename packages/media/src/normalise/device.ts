// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera, for the clip's facts (LIB1-OEM): a photo's EXIF make and model first, then what the phone wrote
 * into the movie (probe/map.ts). Each name is cut to the facts' lengths; an empty one is left out.
 */
import type { MediaFacts } from '@taalcut/core';
import type { PhoneMetadata } from '../probe/types';
import type { PlanStill } from './types';

type Device = NonNullable<MediaFacts['device']>;

const LIMITS: Readonly<Record<keyof Device, number>> = {
  make: 64,
  model: 64,
  modelCode: 32,
  lens: 64,
  app: 40,
  appDevice: 40,
};

export function deviceOf(still: PlanStill | undefined, phone: PhoneMetadata | undefined): Device | undefined {
  const names: Record<keyof Device, string | undefined> = {
    make: still?.make ?? phone?.make,
    model: still?.model ?? phone?.model,
    modelCode: phone?.modelCode,
    lens: phone?.lens,
    app: phone?.app,
    appDevice: phone?.appDevice,
  };
  const device: Partial<Record<keyof Device, string>> = {};
  for (const [field, limit] of Object.entries(LIMITS) as [keyof Device, number][]) {
    const value = names[field]?.trim().slice(0, limit);
    if (value) device[field] = value;
  }
  return Object.keys(device).length > 0 ? device : undefined;
}

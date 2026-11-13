// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* section: /ai/ › Profiles and Local only · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the section arrives once (its heading, lead, controls and map in turn) · the controls' own (profile chosen,
 *   Local only on or off) drive the map's (see map/stage.tsx) · without JavaScript (Everyday, Local only off, every
 *   fact in words).
 * A map of what leaves your computer, not a settings form: the two settings that decide it sit in a compact rail over
 * the zone each one governs (Local only over your computer, the profile over outside it, where the AI you chose is),
 * and the map under them answers both, the things that cross as real cards captioned in the app's own words. */

import { useId, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Arrive, Section } from '#components/ui/section';
import { PROFILES_DEMO } from '#content/providers';
import { DEFAULT_STATE, type MapState } from './map/model';
import { LocalOnlySwitch, ProfilePicker } from './map/rail';
import { MapStage } from './map/stage';

export function LocalSection() {
  const [state, setState] = useState<MapState>(DEFAULT_STATE);
  const reduce = useReducedMotionPref();
  const headingId = useId();
  return (
    <Section id="local-only" heading={<span id={headingId}>{PROFILES_DEMO.heading}</span>} lead={PROFILES_DEMO.lead}>
      <div className="flex flex-col gap-5 lg:gap-6">
        <Arrive className="grid gap-x-0 gap-y-5 px-1 sm:px-0 lg:grid-cols-[minmax(0,5fr)_minmax(6rem,1fr)_minmax(0,6fr)]">
          <div className="lg:ps-7 lg:pe-4">
            <LocalOnlySwitch on={state.localOnly} onChange={(localOnly) => setState((s) => ({ ...s, localOnly }))} reduce={reduce} />
          </div>
          <div className="lg:col-start-3 lg:ps-7 lg:pe-1">
            <ProfilePicker value={state.profile} onChange={(profile) => setState((s) => ({ ...s, profile }))} reduce={reduce} />
          </div>
        </Arrive>
        <Arrive>
          <MapStage state={state} labelledBy={headingId} />
        </Arrive>
      </div>
    </Section>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* section: /ai/ › On your computer · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (the server HTML, on screen at load, reduced motion: a 16 GB Mac picked, the meter filled, every
 *   job lit, the model in place) · running (once when it arrives, again on every pick and from Fill the meter again:
 *   the meter fills a segment a beat, the jobs light up teal, then the model rises in, under a second and a half) ·
 *   the picker's own (see device/picker.tsx) · Fill the meter again: the kit's icon button (gone under reduced
 *   motion) · without JavaScript (finished).
 * What your computer runs, as a memory meter: pick your computer and the meter fills to its memory, the jobs that run
 * here at every size light up, and the model the agent runs takes the stage in display type, each word from the six
 * ON_DEVICE facts. On sunken, a different shape from the map under it. */

import { motion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import { ReplayButton, useReplay } from '#components/home/kit';
import { Arrive, Section } from '#components/ui/section';
import { AI_METER } from '#content/ai-map';
import { ON_DEVICE } from '#content/providers';
import { MemoryMeter, STEP } from './device/meter';
import { DEFAULT_DEVICE, type DeviceId, deviceRun, segmentsFor } from './device/model';
import { ComputerPicker } from './device/picker';
import { AgentRun, AlwaysHere } from './device/runs';

/** The run's script, in seconds: the meter starts, the jobs light as it goes, the model rises once it is full. */
const METER_AT = 0.15;
const JOBS_AT = 0.25;

export function DeviceSection() {
  const ref = useRef<HTMLDivElement>(null);
  const pickId = useId();
  const [device, setDevice] = useState<DeviceId>(DEFAULT_DEVICE);
  const { state, replay, run } = useReplay(ref, 0.3);
  const current = deviceRun(device);
  const agentAt = METER_AT + segmentsFor(current.memory) * STEP + 0.2;
  return (
    <Section id="on-device" heading={ON_DEVICE.heading} lead={ON_DEVICE.lead} tone="sunken">
      <Arrive>
        <motion.div
          ref={ref}
          role="group"
          aria-labelledby={pickId}
          data-slot="device-meter"
          data-run={run}
          initial={false}
          animate={state}
          className="flex flex-col gap-10 lg:gap-12"
        >
          <ComputerPicker
            value={device}
            labelId={pickId}
            action={<ReplayButton onReplay={replay} label={AI_METER.replay} />}
            onChange={(id) => {
              setDevice(id);
              replay();
            }}
          />
          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="flex min-w-0 flex-col gap-10">
              <MemoryMeter run={current} at={METER_AT} />
              <AgentRun run={current} at={agentAt} />
            </div>
            <div className="min-w-0 lg:border-l lg:border-rule lg:ps-12">
              <AlwaysHere at={JOBS_AT} />
            </div>
          </div>
        </motion.div>
      </Arrive>
    </Section>
  );
}

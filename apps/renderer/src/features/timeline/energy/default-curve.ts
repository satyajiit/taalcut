// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The default curve Reset puts back (P3-V12): the curve of the version the energy edits started from (walk the
 * template's versions back past every template.setEnergyCurve), laid over the slots of the version shown now:
 * each slot joins the old section its start falls in. With no energy edit behind it, it is the template's own.
 */
import {
  RationalTime,
  TEMPLATE_COMMANDS,
  type EnergyCurve,
  type Template,
  type TemplateVersionSummary,
} from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { energyCurveOf } from './energy-model';

/** The version energy edits started from: `version` itself when no energy edit made it. */
export function originOf(versions: readonly TemplateVersionSummary[], version: number): number {
  const byVersion = new Map(versions.map((entry) => [entry.version, entry]));
  let at = byVersion.get(version);
  while (at && at.command === TEMPLATE_COMMANDS.setEnergyCurve && at.parentVersion !== null)
    at = byVersion.get(at.parentVersion);
  return at?.version ?? version;
}

/** `origin`'s own curve over `current`'s slots: every slot takes the section its start fell in. */
export function curveOver(origin: Template, current: Template): EnergyCurve {
  const curve = energyCurveOf(origin);
  const rate = origin.canvas.rate;
  const frames = (time: RationalTime) => RationalTime.toFrames(time, rate);
  const index = new Map<string, number>(origin.slots.map((slot, at) => [slot.id, at]));
  const ends = curve.sections.map((section) => {
    const last = origin.slots[index.get(section.toSlotId) ?? -1];
    return last ? frames(last.start) + frames(last.duration) : 0;
  });
  const sections: EnergyCurve['sections'][number][] = [];
  let open: { at: number; from: Template['slots'][number]; to: Template['slots'][number] } | null = null;
  const close = () => {
    const section = open ? curve.sections[open.at] : undefined;
    if (open && section) sections.push({ ...section, fromSlotId: open.from.id, toSlotId: open.to.id });
  };
  for (const slot of current.slots) {
    const start = frames(slot.start);
    const found = ends.findIndex((end) => start < end);
    const at = found === -1 ? curve.sections.length - 1 : found;
    if (open && open.at === at) open.to = slot;
    else {
      close();
      open = { at, from: slot, to: slot };
    }
  }
  close();
  return sections.length > 0 ? { sections } : energyCurveOf(current);
}

/** Reset's curve for `template`: its own until the versions say an energy edit made it. */
export function useDefaultCurve(template: Template): EnergyCurve {
  const backend = useBackend();
  const [curve, setCurve] = useState<EnergyCurve>(() => energyCurveOf(template));
  useEffect(() => {
    setCurve(energyCurveOf(template));
    const controller = new AbortController();
    void (async () => {
      try {
        const versions = await backend.templates.versions(
          { templateId: template.id },
          { signal: controller.signal },
        );
        const origin = originOf(versions, template.version);
        if (origin === template.version) return;
        const found = await backend.templates.get(
          { templateId: template.id, version: origin },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setCurve(curveOver(found.template, template));
      } catch {
        // No history to read (gone, or offline): the template's own curve stands.
      }
    })();
    return () => controller.abort();
  }, [backend, template]);
  return curve;
}

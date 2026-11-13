// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gap handling and flow extensions in the agent process (packages/agent SPEC sections 25 and 26, P3-B8):
 * the gaps' reader over the timeline service (the cast says what is a gap, and FIX-GAPS which picks are weak by
 * casting's own line, with what the library says each candidate shows; the template gives each slot's intent and
 * its format's shortest length), the image path the gap card prices (models' first available
 * route), and the extensions composed against the skills and tools this process has. The voice steps join
 * only once the audio lane registers `voice.director` and `voice.finalize`. FIX-ASK: what each slot carries, the
 * clips other shots could give an open one, and the person's new clips (agent-gap-offers.ts).
 */
import {
  EventBusToken,
  ok,
  parseId,
  RationalTime,
  TemplateStoreToken,
  TimelineStoreToken,
  VoiceProviderToken,
  type AsyncResult,
  type Container,
  type GapView,
  type Template,
  type Timeline,
} from '@taalcut/core';
import {
  composeFlowExtensions,
  gapsExtension,
  gapTimelineOf,
  VOICE_FINALIZE_TOOL,
  VOICE_SKILL,
  voiceExtension,
  voiceFinalizeExtension,
  type AgentGapsOptions,
  type FlowExtension,
  type FlowExtensionDeps,
  type GapsDeps,
  type ImagePath,
  type SkillRegistry,
} from '@taalcut/agent';
import { shotDescriptions } from '@taalcut/library';
import { ImageProvidersToken, imagePathAvailable } from '@taalcut/models';
import { getFormat } from '@taalcut/templates';
import { createTimelineService, librarianSettler, storeTemplateReader } from '@taalcut/timeline';
import { LibraryDatabaseToken, ModelProfilesToken, ToolRegistryToken } from '../../shared/tokens';
import { carriesOf, gapClips, withOffers } from './agent-gap-offers';

interface Readers {
  readonly timeline: (timelineId: string) => AsyncResult<Timeline>;
  readonly template: (
    ref: { readonly id: string; readonly version?: number } | null,
  ) => Promise<Template | undefined>;
}

function readers(container: Container): Readers | undefined {
  if (!container.has(TimelineStoreToken)) return undefined;
  const timelines = createTimelineService({
    store: container.resolve(TimelineStoreToken),
    events: container.resolve(EventBusToken),
  });
  const templates = container.has(TemplateStoreToken)
    ? storeTemplateReader(container.resolve(TemplateStoreToken))
    : undefined;
  return {
    async timeline(timelineId) {
      const id = parseId<'Timeline'>(timelineId);
      return id.ok ? timelines.read(id.value) : id;
    },
    async template(ref) {
      const id = ref ? parseId<'Template'>(ref.id) : undefined;
      if (!templates || !id?.ok) return undefined;
      const read = await templates.read({
        id: id.value,
        ...(ref?.version !== undefined ? { version: ref.version } : {}),
      });
      return read.ok ? read.value : undefined;
    },
  };
}

/** The format a template was planned from, if any (a reference's breakdown has none). */
function formatOf(template: Template | undefined) {
  if (template?.origin.kind !== 'format') return undefined;
  const format = getFormat(template.origin.formatId);
  return format.ok ? format.value.summary : undefined;
}

function intents(template: Template | undefined): (slotId: string) => GapView['intent'] {
  const bySlot = new Map<string, GapView['intent']>(
    (template?.slots ?? []).map((slot) => [
      slot.id,
      {
        text: slot.intent.text,
        shotType: slot.intent.shotType,
        motion: slot.intent.motion,
        energy: slot.intent.energy,
      },
    ]),
  );
  return (slotId) => bySlot.get(slotId) ?? null;
}

/** models' first available image path, as the gap card prices it; an unknown price isn't offered. */
function imagePath(container: Container): GapsDeps['images'] {
  if (!container.has(ImageProvidersToken)) return undefined;
  const deps = {
    providers: container.resolve(ImageProvidersToken),
    selector: container.resolve(ModelProfilesToken),
  };
  return async (signal): Promise<ImagePath> => {
    const path = await imagePathAvailable(deps, { size: 'final', count: 1 }, signal);
    if (!path || path.estimateUsd === null) return { ok: false, reason: 'noImageModel' };
    return {
      ok: true,
      provider: path.provider,
      model: path.model,
      usdPerImage: path.estimateUsd,
      estimated: path.estimated,
    };
  };
}

/** What the library says each shot shows; none when it can't be read (the card then shows the fit alone). */
function describer(container: Container): (shotIds: readonly string[]) => ReadonlyMap<string, string> {
  if (!container.has(LibraryDatabaseToken)) return () => new Map();
  return (shotIds) => {
    try {
      return shotDescriptions(container.resolve(LibraryDatabaseToken), shotIds);
    } catch {
      return new Map();
    }
  };
}

function gapsDeps(container: Container, localOnly: () => boolean): GapsDeps | undefined {
  const read = readers(container);
  if (!read) return undefined;
  const images = imagePath(container);
  const describe = describer(container);
  const readAll = async (timelineId: string) => {
    const timeline = await read.timeline(timelineId);
    if (!timeline.ok) return timeline;
    const template = await read.template(timeline.value.template);
    const format = formatOf(template);
    const rate = timeline.value.canvas.rate;
    // Filled slots already have casting's best library pick; only genuinely empty slots interrupt the flow.
    const gaps = gapTimelineOf(timeline.value, {
      minDuration: format ? RationalTime.fromSeconds(format.minSeconds, rate) : null,
      intentOf: intents(template),
      carriesOf: carriesOf(template),
    });
    return ok({ timeline: timeline.value, template, gaps });
  };
  const clips = gapClips(container, readAll);
  return {
    source: {
      async read(timelineId, signal, options) {
        const got = await readAll(timelineId);
        if (!got.ok) return got;
        // FIX-ASK: the clips other shots have and other parts of used ones, scored by casting, when asked.
        return ok(
          options?.offers ? await withOffers(container, got.value, describe, signal) : got.value.gaps,
        );
      },
    },
    ...(images ? { images } : {}),
    ...(clips ? { clips } : {}),
    localOnly,
  };
}

const registeredIn = (container: Container) => {
  const tools = container.resolve(ToolRegistryToken);
  return (tool: string) => tools.describe(tool) !== undefined;
};

/** `agentSkillModule`'s gaps options: composed once the timelines are stored here. */
export function agentGapsOptions(
  container: Container,
  localOnly: () => boolean,
): { readonly gaps?: AgentGapsOptions } {
  const deps = gapsDeps(container, localOnly);
  return deps ? { gaps: { deps, registered: registeredIn(container) } } : {};
}

/** The voice steps' reads: draft lines and the template's audio, from the stored timeline. */
function voiceExtensions(container: Container, registered: (tool: string) => boolean): FlowExtension[] {
  const read = readers(container);
  if (!read || !container.has(VoiceProviderToken)) return [];
  const voice = container.resolve(VoiceProviderToken);
  const draftLines = async (timelineId: string): AsyncResult<number> => {
    const timeline = await read.timeline(timelineId);
    if (!timeline.ok) return timeline;
    return ok(timeline.value.voiceover?.lines.filter((line) => line.quality === 'draft').length ?? 0);
  };
  return [
    voiceExtension({
      available: () => voice.available().ok,
      templateAudio: async (templateId) => {
        const template = await read.template({ id: templateId });
        return ok(formatOf(template)?.audio ?? null);
      },
    }),
    ...(registered(VOICE_FINALIZE_TOOL) ? [voiceFinalizeExtension({ draftLines })] : []),
  ];
}

/**
 * The steps settled from what is stored when their model's handoff never passes: the Librarian's, from its stored
 * timelines (timeline's librarian-settle.ts). The gaps step is settled by its own extension.
 */
function stepSettlers(container: Container, skills: SkillRegistry): FlowExtensionDeps['settlers'] {
  const read = readers(container);
  if (!read || !skills.get(LIBRARIAN_SKILL)) return undefined;
  return { [LIBRARIAN_SKILL]: librarianSettler({ service: { read: read.timeline } }) };
}

const LIBRARIAN_SKILL = 'timeline.librarian';

/**
 * The flow extensions this process can run (createAgent's `phase3.flowExtensions`): gaps once its skill
 * composed, the voice steps once audio's skill and tool are there, and the settled steps. A wiring mistake is
 * logged, never fatal.
 */
export function flowExtensionDeps(
  container: Container,
  skills: SkillRegistry,
  localOnly: () => boolean,
): { readonly flowExtensions?: FlowExtensionDeps } {
  const registered = registeredIn(container);
  const deps = gapsDeps(container, localOnly);
  const extensions: FlowExtension[] = [
    ...(deps && skills.get('agent.gaps') ? [gapsExtension({ ...deps, registered })] : []),
    ...(skills.get(VOICE_SKILL) ? voiceExtensions(container, registered) : []),
  ];
  const settlers = stepSettlers(container, skills);
  const settled = settlers ? { settlers } : {};
  if (extensions.length === 0) return settlers ? { flowExtensions: { extensions: [], ...settled } } : {};
  const composed = composeFlowExtensions(extensions, skills, registered);
  if (composed.ok) return { flowExtensions: { ...composed.value, ...settled } };
  console.warn(`[agent] flow extensions not composed: ${composed.error.detail ?? composed.error.code}`);
  return settlers ? { flowExtensions: { extensions: [], ...settled } } : {};
}

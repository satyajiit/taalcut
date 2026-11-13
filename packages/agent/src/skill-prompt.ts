// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * System prompts for Phase 2 (SPEC sections 11 and 13): the skills and flows
 * the main model may start, and the prompt a skill's own turns run with
 * (SOUL.md + rules + `# Skill: <id>` + its prompt + the catalogue of its
 * tools only). Model-facing text, not user-facing copy.
 */
import type { AnySkill } from '@taalcut/core';
import { formatCatalogue, type ToolCatalogueEntry } from '@taalcut/tools';
import { hasMotionTools, HYPERFRAMES_MOTION_SKILLS } from './hyperframes-skills';
import { operatingRules, systemPrompt, type Soul } from './prompt';
import { offeredWhole } from './skill-offer';
import { toolOffer } from './tool-offer';
import { personaParts } from './soul/dials';

export const SKILL_RULES = `# Working as a skill

- You are running one skill of a larger plan. Only this skill's tools exist for you; any other call is refused.
- When the skill's work is done, call handOff with the structured ids and facts asked for, and in the same turn write a brief one- or two-sentence closing message to the creator in your response text stating what changed (in Taal's voice, with no follow-up questions).
- Taalcut checks the handoff with a second method. If a check fails you get its reason: fix the work and hand off again.
- What the user changed (a locked shot, a swap, a renamed slot) is their decision. Keep it.`;

export const QUESTION_RULE =
  '- Ask the user only with askUser, only the questions it offers, and only when they have not already said (for example "make 3 versions").';

export const COMPACT_TOOL_CATALOGUE =
  '# Tool discovery\n\nOnly the tools that fit this turn are loaded. Use findTools to load another tool this step permits.';

export const FLOW_RULES = `# Flows

When shorts.generate is listed in the Tool catalogue and the user wants a short extracted or repurposed from an existing video (a library asset, local file or YouTube URL), call updatePlan on your first turn with plain steps, without a skill. The first turn only offers planning tools; on the plain step use findTools to load the shorts tools if they are not yet offered. Use shorts.createProject if there is no projectId; use shorts.importSource for a file or URL, or reuse the supplied library assetId; then call shorts.generate with the returned projectId and assetId, preserving any sourceUrl and the requested duration. This source-excerpt request does not use startFlow: the source is the footage to edit, not a reference whose style should be copied. shorts.generate prepares the editable timeline and finished exports after QA; never publish automatically.

For other requests to make a video, call startFlow on your first turn instead of updatePlan:
- path "reference" ONLY when the user gives a reference reel link or file whose full edit structure and template they want copied;
- path "template" when they ask to use a stored template by id;
- path "describe" when they describe a story, milestone, narrative, custom shot count/pacing, or voiceover reel (for example "use my new home clips, our first own house after 10+ years in a rented house, ground floor done, 1st floor in progress", or when they only reference a link for its music track or a short opening hook clip while specifying their own custom shot count, duration, or montage structure — do NOT use path "reference" just to create an unnecessary template; summarize their request plus any music/clip URL concisely in brief.text, aiming under 500 chars since selected assets and the full user message stay in history automatically, and pass the requested or appropriate duration up to 120s in brief.targetSeconds — e.g. 60–120s when showcasing many wide room/tour clips so each shot gets breathing room);
- path "library" to make something from their newest footage when no specific story brief is given.
Taalcut then runs the skills in order and asks the user once, before the export.`;

/** The main model's prompt: the Phase 1 prompt, plus the skills and flows when any skill is registered. */
export function mainSystemPrompt(
  soul: Soul,
  catalogue: readonly ToolCatalogueEntry[],
  skills: readonly AnySkill[],
  flows: boolean,
  options?: { readonly catalogue?: boolean },
): string {
  const base = systemPrompt(soul, catalogue, options);
  if (skills.length === 0) return base;
  const lines = skills.map((s) => `skill: ${s.id}: ${s.description}`).join('\n');
  return [
    base,
    `# Skills\n\nOne line per skill: skill: id: what it does.\n\n${lines}`,
    ...(flows ? [FLOW_RULES] : []),
  ].join('\n\n');
}

/**
 * A skill step's prompt: only its own instructions and its own tools. SOUL.md stays whole: a step's text reaches
 * the user's chat like the main agent's (SPEC 35). A skill offered all its tools gets no catalogue: their
 * descriptions are in the tools themselves, and a catalogue would repeat each one on every turn (LRN1-CTX).
 */
export function skillSystemPrompt(
  soul: Soul,
  skill: AnySkill,
  subset: readonly ToolCatalogueEntry[],
  /** AGT2: whether the step is offered every tool it allows (skill-offer.ts `offeredWhole`, by its window). */
  whole: boolean = offeredWhole(skill, toolOffer(undefined)),
  /** AGT2: how many of its tools the catalogue leaves out (step-catalogue.ts), which findTools finds. */
  more = 0,
  /** An oversized offer keeps discovery, without repeating its catalogue beside the tool schemas. */
  compactCatalogue = false,
): string {
  const rules = skill.questions?.length ? `${SKILL_RULES}\n${QUESTION_RULE}` : SKILL_RULES;
  return [
    ...personaParts(soul),
    operatingRules(!whole),
    // HFW1: the Designer carries its own composition doctrine; the kit's fields would contradict it.
    ...(hasMotionTools(subset) &&
    ![
      'render.designer',
      'timeline.librarian',
      'timeline.maker',
      'timeline.editor',
      'render.reviewer',
      'agent.gaps',
    ].includes(skill.id)
      ? [HYPERFRAMES_MOTION_SKILLS]
      : []),
    rules,
    `# Skill: ${skill.id}\n\n${skill.prompt.trim()}`,
    ...(compactCatalogue
      ? [COMPACT_TOOL_CATALOGUE]
      : whole
        ? []
        : [
            `# Tool catalogue\n\nOne line per tool: family: name: what it does.\n\n${formatCatalogue(subset)}` +
              (more > 0
                ? `\n\n${more} more of this skill's tools are not listed: findTools finds them by what they do.`
                : ''),
          ]),
  ].join('\n\n');
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an export's Content Credentials assert (SPEC P3.3), as the manifest definition the sidecar signs.
 * Pure. `c2pa.actions.v2` only (the v1 label is deprecated). The first action is `c2pa.created` with the
 * IPTC digital source type of the whole video, then one `c2pa.placed` per ingredient; a single clip with no
 * edits beyond the conform is `c2pa.opened` (its clip `parentOf`) then `c2pa.transcoded`.
 *
 * Digital source types, from IPTC's vocabulary (cv.iptc.org/newscodes/digitalsourcetype, read 2026-10-14):
 * - trainedAlgorithmicMedia, "Created using Generative AI": only when a model made every visual and audible part.
 * - compositeSynthetic, "Mix or composite of several elements, at least one of which is Generative AI".
 * - compositeCapture, "Mix or composite of several elements that are all captures of real life".
 * - compositeWithTrainedAlgorithmicMedia, "Edited using Generative AI": on each generated part's placement.
 * - digitalCreation, "created by a human using non-generative tools": an export with no media parts (text only).
 * Footage no model made never gets an AI term: a transcode of camera footage is not AI.
 */
import type { AiInventory, MediaPart } from './ai-inventory';
import type { ManifestDefinition, SignIngredientFile } from './sidecar';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

export const DIGITAL_SOURCE_TYPES = {
  trainedAlgorithmicMedia: `${IPTC}trainedAlgorithmicMedia`,
  compositeSynthetic: `${IPTC}compositeSynthetic`,
  compositeCapture: `${IPTC}compositeCapture`,
  compositeWithTrainedAlgorithmicMedia: `${IPTC}compositeWithTrainedAlgorithmicMedia`,
  digitalCreation: `${IPTC}digitalCreation`,
} as const;

/** The terms that say a model made or changed something. */
export const AI_DIGITAL_SOURCE_TYPES: ReadonlySet<string> = new Set([
  DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia,
  DIGITAL_SOURCE_TYPES.compositeSynthetic,
  DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia,
]);

export const ACTIONS_LABEL = 'c2pa.actions.v2';

export interface ExportManifestInput {
  /** The manifest's title: the render's display name is the caller's choice, never a path. */
  readonly title: string;
  /** Taalcut's version, for `claim_generator_info` and the software agent. */
  readonly generatorVersion: string;
  readonly inventory: AiInventory;
  /** One clip on screen and nothing changed beyond the conform: no text, captions, graphics, music or speed. */
  readonly singleClipNoEdits: boolean;
  /** Parts whose source carries its own Content Credentials (read before re-encoding): part id → file. */
  readonly signedSources: ReadonlyMap<string, string>;
}

export interface ExportManifest {
  readonly definition: ManifestDefinition;
  /** Ingredients read from their files (their stores travel with the export). */
  readonly ingredients: readonly SignIngredientFile[];
  /** The digital source types the manifest asserts, for QA's inventory check. */
  readonly digitalSourceTypes: readonly string[];
}

type Json = ManifestDefinition[string];
type Relationship = SignIngredientFile['relationship'];

/** The video's own digital source type. */
export function wholeSourceType(inventory: AiInventory): string {
  if (inventory.parts.length === 0) return DIGITAL_SOURCE_TYPES.digitalCreation;
  if (inventory.allGenerated) return DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia;
  if (inventory.generated.length > 0) return DIGITAL_SOURCE_TYPES.compositeSynthetic;
  return DIGITAL_SOURCE_TYPES.compositeCapture;
}

const cleanTitle = (title: string) => title.replace(/[\\/]/g, ' ').trim().slice(0, 120) || 'Taalcut export';

interface Collected {
  readonly files: SignIngredientFile[];
  readonly listed: { [key: string]: Json }[];
}

/** A part as an ingredient: from its file when it carries a store, else described in the definition. */
function addIngredient(
  part: MediaPart,
  relationship: Relationship,
  input: ExportManifestInput,
  into: Collected,
) {
  const path = input.signedSources.get(part.id);
  if (path) into.files.push({ path, title: part.title, relationship, label: part.label });
  else into.listed.push({ title: part.title, relationship, label: part.label });
}

function placed(part: MediaPart): { [key: string]: Json } {
  return {
    action: 'c2pa.placed',
    parameters: { ingredientIds: [part.label] },
    ...(part.generated
      ? { digitalSourceType: DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia }
      : {}),
  };
}

export function exportManifest(input: ExportManifestInput): ExportManifest {
  const agent = { name: 'Taalcut', version: input.generatorVersion };
  const collected: Collected = { files: [], listed: [] };
  const { inventory } = input;
  const single = inventory.parts.length === 1 ? inventory.parts[0] : undefined;
  let actions: { [key: string]: Json }[];
  let sourceTypes: string[];
  // A generated clip is never just "opened and transcoded": its AI origin has to be said in this manifest.
  if (input.singleClipNoEdits && single && single.kind === 'clip' && !single.generated) {
    addIngredient(single, 'parentOf', input, collected);
    actions = [
      { action: 'c2pa.opened', softwareAgent: agent, parameters: { ingredientIds: [single.label] } },
      { action: 'c2pa.transcoded', softwareAgent: agent },
    ];
    sourceTypes = [];
  } else {
    const whole = wholeSourceType(inventory);
    const ingredients = inventory.parts.filter((part) => part.generated || input.signedSources.has(part.id));
    for (const part of ingredients) addIngredient(part, 'componentOf', input, collected);
    actions = [
      { action: 'c2pa.created', softwareAgent: agent, digitalSourceType: whole },
      ...ingredients.map(placed),
    ];
    sourceTypes = [
      whole,
      ...(inventory.generated.length > 0 ? [DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia] : []),
    ];
  }
  return {
    definition: {
      title: cleanTitle(input.title),
      claim_generator_info: [agent],
      ingredients: collected.listed,
      assertions: [{ label: ACTIONS_LABEL, data: { actions } }],
    },
    ingredients: collected.files,
    digitalSourceTypes: sourceTypes,
  };
}

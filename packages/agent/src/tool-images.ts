// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a tool's pictures for a model that sees (SPEC "Tool images"). A tool declares the images its output carries
 * (ToolSpec `images`, artifact refs such as `workspace.render`'s stills); before a model call, the newest call whose
 * output has images gets them attached to its tool message, read from the artifact store, and every older call stays
 * its words and summaries (the design loop's `withoutPictures` rule: the latest round's pictures are enough). A
 * module whose chain has a model without image input gets no pictures: it reads the tool's words, which say what the
 * frame checks found. The prompt hash and the log keep the messages without pictures, so replay compares the same.
 */
import type { ArtifactId, ArtifactRef, ArtifactStore } from '@taalcut/core';
import type { ChatMessage, ContentPart } from '@taalcut/models';
import type { ToolRegistry } from '@taalcut/tools';
import type { RunState, ToolCallState } from './run-state';

/** The most pictures one call attaches. */
export const TOOL_IMAGES_MAX = 12;
/** Bulk library.getAsset metadata reads attach at most this many contact sheets per turn. */
const ASSET_CONTACT_SHEETS_MAX = 4;
/** Only attach pictures from the newest assistant turn (or 1 turn prior, e.g. workspace.lint after workspace.render). */
const PICTURED_LOOKBACK_TURNS = 2;
/** A picture larger than this is left as its summary. */
const IMAGE_BYTES_MAX = 4 * 1024 * 1024;

type Registry = Pick<ToolRegistry, 'resolve'>;

/** The image refs a completed call's output carries, from its tool's `images` hook (a throw is none). */
export function imagesOf(call: ToolCallState, registry: Registry): readonly ArtifactRef[] {
  const outcome = call.outcome;
  if (outcome?.kind !== 'completed' || call.requested.meta || outcome.payload.output.kind !== 'inline')
    return [];
  const tool = registry.resolve(call.requested.tool, outcome.payload.version);
  if (!tool?.spec.images) return [];
  try {
    return tool.spec
      .images(outcome.payload.output.value as never)
      .filter((ref) => ref.mediaType.startsWith('image/'));
  } catch {
    return [];
  }
}

/** The newest call in the transcript whose output has images, and its refs. */
export function newestPictured(
  state: RunState,
  registry: Registry,
): { readonly call: ToolCallState; readonly refs: readonly ArtifactRef[] } | undefined {
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const item = state.transcript[index];
    if (item?.kind !== 'assistant') continue;
    for (const id of [...item.toolCallIds].reverse()) {
      const call = state.toolCalls[id];
      const refs = call ? imagesOf(call, registry) : [];
      if (call && refs.length > 0) return { call, refs };
    }
  }
  return undefined;
}

async function callImages(
  call: ToolCallState,
  registry: Registry,
  artifacts: ArtifactStore,
): Promise<readonly ArtifactRef[]> {
  const outcome = call.outcome;
  if (outcome?.kind !== 'completed' || call.requested.meta) return [];
  const tool = registry.resolve(call.requested.tool, outcome.payload.version);
  if (!tool?.spec.images) return [];
  try {
    let value: unknown;
    if (outcome.payload.output.kind === 'inline') {
      value = outcome.payload.output.value;
    } else if (
      outcome.payload.output.kind === 'artifact' &&
      outcome.payload.output.ref.mediaType === 'application/json'
    ) {
      const stored = await artifacts.get(outcome.payload.output.ref.id as ArtifactId);
      if (!stored.ok) return [];
      value = JSON.parse(new TextDecoder().decode(stored.value.data));
    } else {
      return [];
    }
    return tool.spec.images(value as never).filter((ref) => ref.mediaType.startsWith('image/'));
  } catch {
    return [];
  }
}

async function pictures(
  artifacts: ArtifactStore,
  refs: readonly ArtifactRef[],
  limit = TOOL_IMAGES_MAX,
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  for (const ref of refs) {
    if (parts.length >= limit) break;
    if (ref.bytes > IMAGE_BYTES_MAX) continue;
    const stored = await artifacts.get(ref.id as ArtifactId);
    if (!stored.ok) continue;
    parts.push({
      type: 'image',
      data: Buffer.from(stored.value.data).toString('base64'),
      mimeType: stored.value.ref.mediaType,
    });
  }
  return parts;
}

/**
 * The messages with the newest pictured turn's images on its tool messages (up to TOOL_IMAGES_MAX across parallel
 * calls in that turn, reading spilled JSON artifacts too), for a model that sees images; the same messages otherwise.
 */
export async function withToolImages(
  messages: readonly ChatMessage[],
  state: RunState,
  deps: {
    readonly registry: Registry;
    readonly artifacts?: ArtifactStore | undefined;
    readonly seesImages?: boolean;
  },
): Promise<ChatMessage[]> {
  if (!deps.seesImages || !deps.artifacts) return [...messages];
  let assistantTurnsChecked = 0;
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const item = state.transcript[index];
    if (item?.kind !== 'assistant') continue;
    assistantTurnsChecked += 1;
    if (assistantTurnsChecked > PICTURED_LOOKBACK_TURNS) break;
    const pictured: { call: ToolCallState; refs: readonly ArtifactRef[] }[] = [];
    let assetSheetCount = 0;
    for (const id of item.toolCallIds) {
      const call = state.toolCalls[id];
      if (!call) continue;
      if (call.requested.tool === 'library.getAsset' && assetSheetCount >= ASSET_CONTACT_SHEETS_MAX) continue;
      const refs = await callImages(call, deps.registry, deps.artifacts);
      if (refs.length > 0) {
        if (call.requested.tool === 'library.getAsset') assetSheetCount += 1;
        pictured.push({ call, refs });
      }
    }
    if (pictured.length === 0) continue;
    let remaining = TOOL_IMAGES_MAX;
    const attached = new Map<number, ContentPart[]>();
    for (const entry of pictured) {
      if (remaining <= 0) break;
      const target = entry.call.requested.modelToolCallId;
      const at = messages.findIndex((message) => message.role === 'tool' && message.toolCallId === target);
      if (at < 0 || messages[at]?.role !== 'tool') continue;
      const parts = await pictures(deps.artifacts, entry.refs, remaining);
      if (parts.length === 0) continue;
      remaining -= parts.length;
      attached.set(at, [...(attached.get(at) ?? []), ...parts]);
    }
    if (attached.size === 0) return [...messages];
    return messages.map((entry, at) => {
      const parts = attached.get(at);
      if (!parts || entry.role !== 'tool') return entry;
      const text =
        typeof entry.content === 'string' ? [{ type: 'text' as const, text: entry.content }] : entry.content;
      return { ...entry, content: [...text, ...parts] };
    });
  }
  return [...messages];
}

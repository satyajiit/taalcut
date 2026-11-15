// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: a graphic's designs as the picker shows them, read from the timeline it is on (the kit imports core's types
 * only). Each option names a composition the timeline keeps a copy of (its newest version); the one the graphic is
 * drawn with is in use. A still of each over the person's video comes from the project's workspace files
 * (CardData.designStill, read once per still), else from the card's artifact, else it is the frame of the shot the
 * graphic sits on. The card's own snapshot stands in until the live timeline is in.
 */
import type {
  CardOf,
  GraphicComposition,
  GraphicItem,
  GRAPHICS_COMMANDS,
  ProjectId,
  Timeline,
} from '@taalcut/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCardData } from './card-data';
import type { DesignOptionView } from './design-option-picker';

/** The command a tile dispatches: a typed literal, so a renamed command in core fails the build here. */
export const CHOOSE_OPTION: (typeof GRAPHICS_COMMANDS)['chooseOption'] = 'graphics.chooseOption';

type CardOption = NonNullable<CardOf<'motionGraphic'>['options']>[number];

/** The newest copy the timeline keeps of a composition. */
export function newestDesign(
  timeline: Pick<Timeline, 'graphicCompositions'> | null | undefined,
  compositionId: string,
): GraphicComposition | null {
  let newest: GraphicComposition | null = null;
  for (const copy of timeline?.graphicCompositions ?? [])
    if (copy.id === compositionId && (!newest || copy.version > newest.version)) newest = copy;
  return newest;
}

/** The canvas's width over its height; 9:16 until the timeline is in. */
export function canvasAspect(timeline: Pick<Timeline, 'canvas'> | null | undefined): number {
  const canvas = timeline?.canvas;
  return canvas && canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 9 / 16;
}

/** Stills by sha256, each read once per card; undefined until one arrives. */
function useStills(projectId: ProjectId, shas: readonly string[]): (sha256: string) => string | undefined {
  const data = useCardData();
  const [stills, setStills] = useState<ReadonlyMap<string, string>>(new Map());
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wanted = shas.join(' ');
  useEffect(() => {
    if (!data.designStill) return;
    for (const sha256 of wanted.split(' ').filter(Boolean)) {
      const key = `${projectId}:${sha256}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      data.designStill(projectId, sha256).then(
        (url) => {
          if (mounted.current && url) setStills((known) => new Map(known).set(sha256, url));
        },
        () => asked.current.delete(key),
      );
    }
  }, [data, projectId, wanted]);
  return (sha256) => stills.get(sha256);
}

export interface DesignOptionsInput {
  readonly projectId: ProjectId;
  /** The live timeline, when it is in. */
  readonly timeline: Timeline | null | undefined;
  /** The graphic on it, when it is there. */
  readonly item: GraphicItem | null | undefined;
  /** The card's snapshot of the options (the chat), for the names and stills until the timeline is in. */
  readonly snapshot?: readonly CardOption[] | undefined;
  /** The composition the card says is in use, until the timeline is in. */
  readonly snapshotInUse?: string | undefined;
  /** What a tile shows without a still of its own: the frame of the shot under the graphic. */
  readonly fallback: string | null;
}

/** The options to show, in the order they were placed; empty when the graphic has none. */
export function useDesignOptions(input: DesignOptionsInput): readonly DesignOptionView[] {
  const data = useCardData();
  const { timeline, item, snapshot, snapshotInUse, fallback, projectId } = input;
  const designs = item?.options?.designs;
  const shas = useMemo(
    () => (designs ?? []).flatMap((design) => (design.still ? [design.still.sha256] : [])),
    [designs],
  );
  const still = useStills(projectId, shas);
  if (designs && item)
    return designs.map((design) => {
      const known = snapshot?.find((option) => option.compositionId === design.compositionId);
      const own =
        (design.still ? still(design.still.sha256) : undefined) ??
        (known?.frameArtifactId ? (data.artifactUrl?.(known.frameArtifactId) ?? undefined) : undefined);
      return {
        compositionId: design.compositionId,
        name: newestDesign(timeline, design.compositionId)?.name ?? known?.name ?? '',
        idea: design.idea,
        still: own ?? fallback,
        inUse: design.compositionId === item.composition.id,
      };
    });
  return (snapshot ?? []).map((option) => ({
    compositionId: option.compositionId,
    name: option.name,
    idea: option.idea,
    still: (option.frameArtifactId ? data.artifactUrl?.(option.frameArtifactId) : null) ?? fallback,
    inUse: option.compositionId === snapshotInUse,
  }));
}

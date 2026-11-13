// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AssetId,
  CoverImage,
  CoverImageInput,
  Result,
  CastCandidate,
  DerivedFileRef,
  ExportOptions,
  FitPool,
  FitTemplatesResult,
  FormatId,
  ImportStatus,
  ProjectId,
  QaReport,
  RationalTime,
  RenderId,
  RenderSnapshot,
  ShotId,
  SlotId,
  SourceId,
  SourceView,
  Template,
  TemplateId,
  TemplateSummary,
  TemplateSummarySheet,
  Timeline,
  TimelineId,
  TaalcutError,
} from '@taalcut/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CardDataPhase3, StarterChoice } from './card-data-phase3';
import {
  isReadFailure,
  legacyValue,
  READ_REJECTED,
  type CardReadFailure,
  type LiveRead,
  type LiveReadState,
} from './live-read';
import type { TimelinePreviewProps } from './timeline-preview';

/** A template at one version, as `templates.get` returns it. */
export interface TemplateAt {
  readonly summary: TemplateSummary;
  readonly template: Template;
  /** Who made the head after the version a card names: you (ui, shortcut) or the agent; null when nobody did. */
  readonly changedBy?: 'you' | 'ai' | null;
}

/**
 * Where live cards read the stored things they name (packages/ui SPEC,
 * protocol rule 1): the card renders its snapshot first, then the newest
 * version from here, and updates when it changes. The kit stays IPC-free: the
 * renderer supplies this over core's contracts (templates, library, indexing)
 * and its events. Anything left out keeps the card on its snapshot.
 *
 * Gone and broken are different answers (UX round 1): a watcher calls back with null only when the thing was
 * deleted, and `onError` when the read or the stream failed for another reason; a read answers undefined when gone
 * and a CardReadFailure when it couldn't read. A card never says "This was deleted." for a dropped stream.
 */
export interface CardData extends CardDataPhase3 {
  coverImage?(input: CoverImageInput): Promise<Result<CoverImage>>;
  /**
   * A template at a version (default: the head). Undefined when it is gone, a CardReadFailure when it couldn't be
   * read now. `since` asks who changed it after that version (TemplateAt.changedBy).
   */
  template?(
    id: TemplateId,
    version?: number,
    since?: number,
  ): Promise<TemplateAt | undefined | CardReadFailure>;
  /** Calls back after the template changes (an edit, ⌘Z). Returns the unsubscribe. */
  watchTemplate?(id: TemplateId, onChange: () => void): () => void;
  /** A source's import as it moves on (library.indexing). Returns the unsubscribe. */
  watchImport?(sourceId: SourceId, onChange: (status: ImportStatus | null) => void): () => void;
  /** The library's sources, for names on cards that only carry ids. */
  sources?(): Promise<readonly SourceView[]>;
  /** A URL the CSP allows for a thumbnail or poster; null shows the viewer grey. */
  mediaUrl?(ref: Pick<DerivedFileRef, 'key' | 'width' | 'height'>): string | null;
  /** A template asset's URL (the contact sheet). */
  templateAssetUrl?(sheet: TemplateSummarySheet): string | null;
  /**
   * BRK1: where a <video> plays the template's kept reel (the media host's template-reel route). Only asked for a
   * template whose summary has `media`; null when there is no way to play it.
   */
  templateReel?(templateId: TemplateId): string | null;
  /** What "Start from a template" offers: saved templates, then the built-in formats, named in the app's words. */
  templateChoices?(): Promise<readonly TemplateChoice[]>;
  /**
   * LRN1-TPL: how well a pool of footage fills the saved templates, best first (timelines.fitTemplates), for the
   * import card's "Templates that fit this footage" and the template picker's order; a CardReadFailure when it
   * couldn't be read now.
   */
  fitTemplates?(pool: FitPool, limit: number): Promise<FitTemplatesResult | CardReadFailure>;

  // Make (P2-M3, P2-M7, P2-M8, P2-M11): timelines, shots, renders and their QA, over core's
  // `timelines`, `library` and `renders` namespaces.
  /**
   * A timeline as it is now, then after every change (timelines.watch); null when it is gone; `onError` when the
   * watch broke for another reason (the card offers Try again, which watches again). Returns the unsubscribe.
   */
  watchTimeline?(
    id: TimelineId,
    onChange: (timeline: Timeline | null) => void,
    onError?: (error: TaalcutError) => void,
  ): () => void;
  /** "Find something else": fresh candidates for one slot (timelines.findAlternates). */
  findAlternates?(input: {
    readonly timelineId: TimelineId;
    readonly slotId: SlotId;
    readonly exclude: readonly ShotId[];
  }): Promise<readonly CastCandidate[] | undefined>;
  /** A shot's frame and words for a pick or an alternate (library.asset); undefined when it is gone. */
  shot?(assetId: AssetId, shotId: ShotId | null): Promise<ShotFrame | undefined>;
  /** An imported image's thumbnail, refreshed when asynchronous indexing finishes. */
  watchAssetImage?(assetId: AssetId, onChange: (url: string | null) => void): () => void;
  /** A render as it is now, then as it moves on (renders.watch); null when it is gone; `onError` as for timelines. */
  watchRender?(
    id: RenderId,
    onChange: (render: RenderSnapshot | null) => void,
    onError?: (error: TaalcutError) => void,
  ): () => void;
  /** Every check of a render, for "View details" (renders.qaReport). */
  qaReport?(renderId: RenderId): Promise<QaReport | undefined>;
  /** A render's poster or file under app://preview (renders.mediaUrl); null when there is none yet. */
  renderMedia?(renderId: RenderId, kind: 'poster' | 'video'): Promise<string | null>;
  /** Presets, the music choice and its acknowledgement, captions (renders.exportOptions). */
  exportOptions?(projectId: ProjectId, timelineId: TimelineId): Promise<ExportOptions | undefined>;
  /**
   * The app's preview of a timeline over proxies (render's PreviewPlayer, or the fake's stand-in), for the
   * timeline and export cards. The kit never loads a player itself.
   */
  renderPreview?(props: TimelinePreviewProps): ReactNode;
}

/** What a card shows for a shot: its frame (null keeps the viewer grey), the file it is from, the AI's words. */
export interface ShotFrame {
  readonly url: string | null;
  /** The file name, shown as written. */
  readonly name: string;
  readonly description: string | null;
  /** The shot's own length, when known. */
  readonly duration: RationalTime | null;
}

export type { TimelinePreviewProps } from './timeline-preview';

/**
 * A row of the template picker. Saved templates go by id (chat start `template`); a format has no
 * template yet, so it starts the describe flow with its id (`formatId`) and its name in the message; a bundled
 * starter (P3-B3) is forked first (`CardActions.addStarter`), then starts the template flow.
 */
export type TemplateChoice =
  | {
      readonly kind: 'template';
      readonly id: TemplateId;
      /** The user's name for it: shown as written. */
      readonly name: string;
      readonly slotCount: number;
      readonly seconds: number;
    }
  | {
      readonly kind: 'format';
      readonly id: FormatId;
      /** Already in the user's language. */
      readonly name: string;
      readonly line: string;
    }
  | StarterChoice;

const CardDataContext = createContext<CardData>({});

export function CardDataProvider({ value, children }: { value: CardData; children: ReactNode }) {
  return <CardDataContext.Provider value={value}>{children}</CardDataContext.Provider>;
}

export function useCardData(): CardData {
  return useContext(CardDataContext);
}

/** One stored thing, watched: `watch` is undefined when nothing supplies it (the card keeps its snapshot). */
type Watch<K, T> = (
  key: K,
  onChange: (value: T | null) => void,
  onError: (error: TaalcutError) => void,
) => () => void;

function useWatchedRead<K extends string, T>(
  key: K | null,
  watch: Watch<K, T> | undefined,
): LiveReadState<T> {
  const [read, setRead] = useState<LiveRead<T>>(() =>
    key !== null && watch ? { status: 'loading', last: null } : { status: 'off' },
  );
  const [round, setRound] = useState(0);
  // The last value shown, and whose it is: a different thing starts from nothing.
  const last = useRef<{ readonly key: K; readonly value: T } | null>(null);
  useEffect(() => {
    if (key === null || !watch) {
      setRead({ status: 'off' });
      return;
    }
    const shown = () => (last.current?.key === key ? last.current.value : null);
    setRead({ status: 'loading', last: shown() });
    return watch(
      key,
      (value) => {
        if (value === null) return setRead({ status: 'gone' });
        last.current = { key, value };
        setRead({ status: 'ready', value });
      },
      (error) => setRead({ status: 'failed', error, last: shown() }),
    );
  }, [key, watch, round]);
  const retry = useCallback(() => setRound((n) => n + 1), []);
  return { read, retry };
}

/** The timeline a card names, kept current (CardData.watchTimeline), with its failure and Try again. */
export function useTimelineRead(id: TimelineId | null): LiveReadState<Timeline> {
  const data = useCardData();
  const source = data.watchTimeline;
  const watch = useMemo<Watch<TimelineId, Timeline> | undefined>(
    () => (source ? (key, onChange, onError) => source.call(data, key, onChange, onError) : undefined),
    [data, source],
  );
  return useWatchedRead(id, watch);
}

/** The render a card names, kept current (CardData.watchRender), with its failure and Try again. */
export function useRenderRead(id: RenderId | null): LiveReadState<RenderSnapshot> {
  const data = useCardData();
  const source = data.watchRender;
  const watch = useMemo<Watch<RenderId, RenderSnapshot> | undefined>(
    () => (source ? (key, onChange, onError) => source.call(data, key, onChange, onError) : undefined),
    [data, source],
  );
  return useWatchedRead(id, watch);
}

/**
 * The template a card names at a version, read again after every change (CardData.template and watchTemplate),
 * with its failure and Try again.
 */
export function useTemplateRead(
  id: TemplateId | null,
  version?: number,
  since?: number,
): LiveReadState<TemplateAt> {
  const data = useCardData();
  const [read, setRead] = useState<LiveRead<TemplateAt>>(() =>
    id && data.template ? { status: 'loading', last: null } : { status: 'off' },
  );
  const [round, setRound] = useState(0);
  const last = useRef<{ readonly id: TemplateId; readonly value: TemplateAt } | null>(null);
  useEffect(() => {
    if (!id || !data.watchTemplate) return;
    return data.watchTemplate(id, () => setRound((n) => n + 1));
  }, [data, id]);
  useEffect(() => {
    let current = true;
    if (!id || !data.template) {
      setRead({ status: 'off' });
      return;
    }
    const shown = () => (last.current?.id === id ? last.current.value : null);
    setRead({ status: 'loading', last: shown() });
    const fail = (error: TaalcutError) => current && setRead({ status: 'failed', error, last: shown() });
    data.template(id, version, since).then(
      (found) => {
        if (!current) return;
        if (isReadFailure(found)) return fail(found.failed);
        if (!found) return setRead({ status: 'gone' });
        last.current = { id, value: found };
        setRead({ status: 'ready', value: found });
      },
      () => fail(READ_REJECTED),
    );
    return () => {
      current = false;
    };
  }, [data, id, version, since, round]);
  const retry = useCallback(() => setRound((n) => n + 1), []);
  return { read, retry };
}

/**
 * The template a card names, kept current: undefined while loading (or unreadable for now), null when there is
 * none (no ref yet, no data source, or it was deleted). Cards that show a failure use useTemplateRead.
 */
export function useLiveTemplate(
  id: TemplateId | null,
  version?: number,
  since?: number,
): TemplateAt | null | undefined {
  return legacyValue(useTemplateRead(id, version, since).read);
}

/** The timeline a card names, kept current: undefined while loading, null when there is none. */
export function useLiveTimeline(id: TimelineId | null): Timeline | null | undefined {
  return legacyValue(useTimelineRead(id).read);
}

/** The render a card names, kept current: undefined while loading, null when there is none. */
export function useLiveRender(id: RenderId | null): RenderSnapshot | null | undefined {
  return legacyValue(useRenderRead(id).read);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  type EventOf,
  type EventType,
  type ImportStatus,
  type RenderSnapshot,
  type Result,
  type SourceId,
  type TaalcutError,
  type TemplateId,
} from '@taalcut/core';
import { useLingui } from '@lingui/react';
import { toSeconds, type CardData, type TemplateAt, type TemplateChoice } from '@taalcut/ui';
import { createElement, useMemo } from 'react';
import { templateName } from '../features/templates/library/library-words';
import { FORMAT_WORDS } from '../features/templates/template-words';
import { CardPreview } from '../features/timeline/preview/card-preview';
import { shotLookup } from '../features/timeline/shot-frames';
import type { Backend } from '../backend/backend';
import { useBackend, useTimelineDocuments } from '../backend/backend';
import { useMediaUrls } from '../services/provider';
import { phase3CardData } from './card-data-phase3';
import { followTimelineDocument } from '../backend/timeline-documents';
import { followStream, isGone } from './follow-stream';
import { phonePanel, watchPhoneOnCable } from './phone-panels';
import { loadStarters } from './starter-actions';

/** Calls `onEvent` for each event of these types until the returned function is called. */
export function subscribeEvents<T extends EventType>(
  backend: Backend,
  types: readonly T[],
  onEvent: (event: EventOf<T>) => void,
): () => void {
  const controller = new AbortController();
  void (async () => {
    const stream = await callRpc(
      backend.events.subscribe({ types: [...types] }, { signal: controller.signal }),
    );
    if (!stream.ok) return;
    try {
      for await (const event of stream.value) {
        if ((types as readonly string[]).includes(event.type)) onEvent(event as EventOf<T>);
      }
    } catch {
      // The subscription ended: the card went away, or main did.
    }
  })();
  return () => controller.abort();
}

/** A read's value, or its failure for the card to show with Try again (CardReadFailure). */
const valueOrFailed = <T>(result: Result<T>): T | { readonly failed: TaalcutError } =>
  result.ok ? result.value : { failed: result.error };

/** Gone (null) only when the error says so; any other failure goes to `onError` (UX round 1). */
const ended =
  (onChange: (value: null) => void, onError: ((error: TaalcutError) => void) | undefined) =>
  (error: TaalcutError) => (isGone(error) || !onError ? onChange(null) : onError(error));

/** One render as it moves on: renders.watch lists a project's renders, so find it there. */
function watchRender(
  backend: Backend,
  id: RenderSnapshot['id'],
  onChange: (render: RenderSnapshot | null) => void,
  onError?: (error: TaalcutError) => void,
) {
  let stop = () => {};
  let stopped = false;
  const end = ended(onChange, onError);
  void callRpc(backend.renders.get({ renderId: id })).then((got) => {
    if (stopped) return;
    if (!got.ok) return end(got.error);
    onChange(got.value);
    stop = followStream(
      (signal) => backend.renders.watch({ projectId: got.value.projectId }, { signal }),
      // The project's list leaves a deleted render out: that one is gone.
      (list) => onChange(list.find((render) => render.id === id) ?? null),
      end,
    );
  });
  return () => {
    stopped = true;
    stop();
  };
}

/** Who made the newest version after `since`: the agent (or another app), or you. */
async function changedSince(
  backend: Backend,
  id: TemplateId,
  since: number,
): Promise<TemplateAt['changedBy']> {
  const versions = await callRpc(backend.templates.versions({ templateId: id }));
  if (!versions.ok) return null;
  const head = versions.value.find((version) => version.isHead);
  if (!head || head.version <= since) return null;
  return head.source === 'agent' || head.source === 'mcp' ? 'ai' : 'you';
}

/**
 * What live cards read, over core's contracts and events (packages/ui
 * CardData): templates at a version and who changed them since, a source's
 * import as it moves on, the library's sources, the URLs the CSP allows
 * for footage and contact sheets, and Make's timelines, shots and renders.
 */
export function useAppCardData(): CardData {
  const backend = useBackend();
  const documents = useTimelineDocuments();
  const media = useMediaUrls();
  const { i18n } = useLingui();
  return useMemo<CardData>(
    () => ({
      coverImage: (input) => callRpc(backend.renders.coverImage(input)),
      async template(id, version, since) {
        const got = await callRpc(backend.templates.get({ templateId: id, ...(version ? { version } : {}) }));
        if (!got.ok) return isGone(got.error) ? undefined : { failed: got.error };
        const changedBy = since === undefined ? null : await changedSince(backend, id, since);
        return { ...got.value, changedBy };
      },
      watchTemplate: (id, onChange) =>
        subscribeEvents(backend, ['library.changed'], ({ payload }) => {
          if (payload.entity === 'template' && payload.ids.includes(id)) onChange();
        }),
      watchImport(sourceId: SourceId, onChange: (status: ImportStatus | null) => void) {
        const pick = (sources: readonly ImportStatus[]) =>
          sources.find((s) => s.sourceId === sourceId) ?? null;
        void callRpc(backend.indexing.status()).then((status) => {
          if (status.ok) onChange(pick(status.value.sources));
        });
        return subscribeEvents(backend, ['library.indexing'], ({ payload }) =>
          onChange(pick(payload.sources)),
        );
      },
      async sources() {
        const result = await callRpc(backend.library.sources());
        return result.ok ? result.value : [];
      },
      mediaUrl: (ref) => media.derived(ref),
      templateAssetUrl: (sheet) => media.templateAsset(sheet),
      // BRK1-REV: the kept reel the review plays.
      templateReel: (templateId) => media.templateReel(templateId),
      // Make (P2-M7, P2-M8, P2-M11): timelines, shots and renders, over core's contracts.
      watchTimeline: (id, onChange, onError) =>
        followTimelineDocument(documents.get(id), onChange, ended(onChange, onError)),
      async findAlternates({ timelineId, slotId, exclude }) {
        const found = await callRpc(
          backend.timelines.findAlternates({ timelineId, slotId, exclude: [...exclude], limit: 6 }),
        );
        return found.ok ? found.value : undefined;
      },
      shot: (assetId, shotId) => shotLookup(backend, media).frame(assetId, shotId),
      watchAssetImage(assetId, onChange) {
        let alive = true;
        let request = 0;
        const refresh = async () => {
          const version = ++request;
          const result = await callRpc(backend.library.asset({ assetId }));
          if (!alive || version !== request) return;
          const thumbnail = result.ok ? result.value.asset.thumbnail : null;
          onChange(thumbnail ? media.derived(thumbnail) : null);
        };
        const stop = subscribeEvents(backend, ['library.changed'], ({ payload }) => {
          if (payload.entity === 'asset' && payload.ids.includes(assetId)) void refresh();
        });
        void refresh();
        return () => {
          alive = false;
          stop();
        };
      },
      watchRender: (id, onChange, onError) => watchRender(backend, id, onChange, onError),
      async qaReport(renderId) {
        const report = await callRpc(backend.renders.qaReport({ renderId }));
        return report.ok ? report.value : undefined;
      },
      // A poster is an image under app://preview the page loads as the media host allows; the file plays as is.
      async renderMedia(renderId, kind) {
        const got = await callRpc(backend.renders.mediaUrl({ renderId, kind }));
        if (!got.ok) return null;
        return kind === 'poster' ? media.preview(got.value.url) : got.value.url;
      },
      async exportOptions(projectId, timelineId) {
        const options = await callRpc(backend.renders.exportOptions({ projectId, timelineId }));
        return options.ok ? options.value : undefined;
      },
      renderPreview: (props) => createElement(CardPreview, props),
      // P3-B4, P3-B5: the source picker's phone, over Wi-Fi or a cable (the cable first when one is plugged in).
      phonePanel,
      watchPhoneOnCable: (onChange) => watchPhoneOnCable(backend, onChange),
      // P3-B3: the bundled starters for this language, best fit first.
      starters: () => loadStarters(backend, i18n),
      // Phase 3 (ui-make): variants, gaps, the hub, cleanup and looks.
      ...phase3CardData(backend, media),
      // "Start from a template": saved templates newest first, then the formats named in this language.
      async templateChoices() {
        const [saved, formats] = await Promise.all([
          callRpc(backend.templates.list({ limit: 20 })),
          callRpc(backend.templates.formats()),
        ]);
        const choices: TemplateChoice[] = [];
        for (const item of saved.ok ? saved.value.items : [])
          choices.push({
            kind: 'template',
            id: item.id,
            // A starter fork still named by its starter's id shows the starter's name in this language.
            name: templateName(i18n, item),
            slotCount: item.slotCount,
            seconds: toSeconds(item.duration),
          });
        for (const format of formats.ok ? formats.value : []) {
          const words = FORMAT_WORDS[format.id];
          if (words)
            choices.push({
              kind: 'format',
              id: format.id,
              name: i18n._(words.name),
              line: i18n._(words.description),
            });
        }
        return choices;
      },
      // LRN1-TPL: how well a pool of footage fills the saved templates, best first.
      fitTemplates: async (pool, limit) =>
        valueOrFailed(await callRpc(backend.timelines.fitTemplates({ pool, templates: {}, limit }))),
    }),
    [backend, documents, media, i18n],
  );
}

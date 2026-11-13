// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub commands (P3-B12, P3-V8). Publish, rate and report are external and person-only, with no inverse. A fork
 * is a write undone by `template.discard`. `hub.openShare` only asks the window to open the Share card.
 */
import {
  defineCommand,
  err,
  HUB_COMMANDS,
  HUB_HANDLE_SETTING,
  HUB_LICENCE_TERMS,
  hubCommandPayloads,
  NotImplementedError,
  ok,
  PERSON_SOURCES,
  TEMPLATE_COMMANDS,
  type AcknowledgementStore,
  type AnyCommand,
  type Clock,
  type HubService,
  type HubSubmissionStore,
  type SettingsStore,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import { libraryNotServed } from '../library/library-metadata';
import { fromHubTemplate, type HubIds } from './from-hub';
import { hubInvalid } from './hub-invalid';
import type { HubIndexClient } from './index-cache';
import type { HubTransport } from './hub-transport';
import type { MyRatings } from './my-ratings';
import { readHubDocument } from './read-document';

export interface HubCommandDeps {
  readonly service: Pick<HubService, 'shareCheck'>;
  readonly transport: HubTransport;
  readonly index: Pick<HubIndexClient, 'loadIndex'>;
  readonly store: Pick<TemplateStore, 'create'>;
  readonly submissions: Pick<HubSubmissionStore, 'record'>;
  readonly acknowledgements: Pick<AcknowledgementStore, 'record'>;
  readonly settings: Pick<SettingsStore, 'set'>;
  readonly myRatings: MyRatings;
  readonly clock: Clock;
  readonly ids: Pick<HubIds, 'slot' | 'overlay'>;
  /** Asks the window to open the Share card (the desktop emits `ui.action`). */
  readonly openShare?: (templateId: TemplateId, version: number | undefined) => void;
  /**
   * The store keeps a lineage's provenance (library-metadata.ts). Default false: `hub.fork` is then
   * core.not_implemented rather than a fork that has lost its hub id, author handle and CC0 licence.
   */
  readonly libraryMetadata?: boolean;
}

/** `core.not_implemented` when nothing can open the card: never a pretend success. */
export function requestOpenShare(
  deps: Pick<HubCommandDeps, 'openShare'>,
  templateId: TemplateId,
  version: number | undefined,
) {
  if (!deps.openShare) return err(NotImplementedError({ feature: 'hub.openShare' }));
  deps.openShare(templateId, version);
  return ok({ opened: true as const });
}

function publishCommand(deps: HubCommandDeps) {
  return defineCommand({
    name: HUB_COMMANDS.publish,
    payload: hubCommandPayloads[HUB_COMMANDS.publish],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    handle: async (payload, context) => {
      const { templateId, version, form } = payload;
      const checked = await deps.service.shareCheck({ templateId, version, form });
      if (!checked.ok) return checked;
      const { document, problems } = checked.value;
      if (problems.length > 0 || !document)
        return err(hubInvalid(problems.length > 0 ? problems : [{ path: '', rule: 'schema' }]));
      const recorded = await deps.acknowledgements.record({
        featureId: HUB_LICENCE_TERMS.featureId,
        termsVersion: HUB_LICENCE_TERMS.termsVersion,
        at: payload.acknowledgedAt,
        context: { templateId },
      });
      if (!recorded.ok) return recorded;
      const handle = await deps.settings.set(HUB_HANDLE_SETTING, form.handle, context);
      if (!handle.ok) return handle;
      const sent = await deps.transport.submit({ template: document });
      if (!sent.ok) return sent;
      const view = {
        id: sent.value.submissionId,
        hubId: sent.value.hubId,
        version: sent.value.version,
        templateId,
        templateVersion: version,
        state: sent.value.state,
        createdAt: deps.clock.now(),
        checkedAt: null,
      };
      const stored = await deps.submissions.record(view, context);
      return stored.ok ? ok({ result: view }) : stored;
    },
  });
}

function forkCommand(deps: HubCommandDeps) {
  return defineCommand({
    name: HUB_COMMANDS.fork,
    payload: hubCommandPayloads[HUB_COMMANDS.fork],
    sideEffect: 'write',
    handle: async (payload, context) => {
      if (!deps.libraryMetadata) return libraryNotServed();
      const loaded = await readHubDocument(
        { transport: deps.transport, loadIndex: (options) => deps.index.loadIndex(options) },
        payload.hubId,
        { version: payload.version, sha256: payload.sha256 },
      );
      if (!loaded.ok) return loaded;
      const { document } = loaded.value;
      const ids = { template: () => payload.templateId, slot: deps.ids.slot, overlay: deps.ids.overlay };
      const built = fromHubTemplate(document, ids, deps.clock.now());
      if (!built.ok) return built;
      const provenance = {
        kind: 'hub' as const,
        hubId: document.id,
        version: document.version,
        handle: document.handle,
        licence: document.licence,
        forkedAt: deps.clock.now(),
        removed: false,
      };
      const created = await deps.store.create(
        built.value,
        { name: document.name, projectId: null, listed: true, provenance },
        context,
      );
      if (!created.ok) return created;
      return ok({
        result: { templateId: payload.templateId, version: 1 },
        inverse: {
          name: TEMPLATE_COMMANDS.discard,
          payload: { projectId: null, templateId: payload.templateId },
        },
      });
    },
  });
}

function rateCommand(deps: HubCommandDeps) {
  return defineCommand({
    name: HUB_COMMANDS.rate,
    payload: hubCommandPayloads[HUB_COMMANDS.rate],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    handle: async ({ hubId, stars }, context) => {
      const sent =
        stars === null
          ? await deps.transport.withdrawRating(hubId)
          : await deps.transport.rate(hubId, { stars });
      if (!sent.ok) return sent;
      const saved = await deps.myRatings.set(hubId, stars, context);
      if (!saved.ok) return saved;
      return ok({ result: { stars, count: sent.value.count, mean: sent.value.mean } });
    },
  });
}

function reportCommand(deps: HubCommandDeps) {
  return defineCommand({
    name: HUB_COMMANDS.report,
    payload: hubCommandPayloads[HUB_COMMANDS.report],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    handle: async ({ hubId, reason, note }) => {
      const sent = await deps.transport.report({ hubId, reason, ...(note !== undefined ? { note } : {}) });
      return sent.ok ? ok({ result: { issue: sent.value.issue } }) : sent;
    },
  });
}

function openShareCommand(deps: HubCommandDeps) {
  return defineCommand({
    name: HUB_COMMANDS.openShare,
    payload: hubCommandPayloads[HUB_COMMANDS.openShare],
    sideEffect: 'read',
    handle: (payload) => {
      const opened = requestOpenShare(deps, payload.templateId, payload.version);
      return opened.ok ? ok({ result: opened.value }) : opened;
    },
  });
}

export function createHubCommands(deps: HubCommandDeps) {
  const publish = publishCommand(deps);
  const fork = forkCommand(deps);
  const rate = rateCommand(deps);
  const report = reportCommand(deps);
  const openShare = openShareCommand(deps);
  const all: AnyCommand[] = [publish, fork, rate, report, openShare];
  return { publish, fork, rate, report, openShare, all };
}

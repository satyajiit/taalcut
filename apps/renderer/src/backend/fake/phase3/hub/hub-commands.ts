// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake hub's commands, as @taalcut/templates' hub-commands.ts runs them (P3-B12, P3-V8). Publish, rate and
 * report are external and person-only (PERSON_SOURCES), never undone: publish refuses a document with problems
 * (hub.invalid), records the CC0 acknowledgement and the handle, then asks the Worker, which can be unreachable,
 * rate-limited or not there at all. A fork checks the file against the index (hub.integrity, hub.hidden, a newer
 * format) and is a write undone by template.discard. hub.openShare asks the window to open the Share dialog
 * (`ui.action`), as main does.
 */
import {
  defineCommand,
  err,
  HUB_COMMANDS,
  HUB_HANDLE_SETTING,
  hubCommandPayloads,
  HubHidden,
  HubIntegrity,
  HubNotFound,
  HubUnsupportedFormat,
  ok,
  PERSON_SOURCES,
  TEMPLATE_COMMANDS,
  type AnyCommand,
  type HubSubmissionView,
  type HubTemplateId,
} from '@taalcut/core';
import { fakeUlid } from '../../library/seed';
import type { Phase3Deps } from '../phase3-deps';
import { fromHubTemplate, hubInvalid } from './hub-convert';
import { hubShareCheck } from './hub-reads';
import { limit, reach, SUBMISSION_KIND, type FakeHubOptions, type HubState } from './hub-state';

const appWide = () => null;

/** The Worker's new mean once this install's stars replace its last ones (or are withdrawn). */
function rerate(state: HubState, hubId: HubTemplateId, stars: number | null) {
  const before = state.ratings.get(hubId) ?? { count: 0, mean: 0 };
  const mine = state.mine.get(hubId);
  let total = before.mean * before.count;
  let count = before.count;
  if (mine !== undefined) {
    total -= mine;
    count -= 1;
  }
  if (stars !== null) {
    total += stars;
    count += 1;
    state.mine.set(hubId, stars);
  } else state.mine.delete(hubId);
  const rating = { count, mean: count > 0 ? Math.round((total / count) * 100) / 100 : 0 };
  if (count > 0) state.ratings.set(hubId, rating);
  else state.ratings.delete(hubId);
  return rating;
}

export function hubCommands(deps: Phase3Deps, state: HubState, options: FakeHubOptions): AnyCommand[] {
  const publish = defineCommand({
    name: HUB_COMMANDS.publish,
    payload: hubCommandPayloads[HUB_COMMANDS.publish],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    project: appWide,
    handle: async (payload, context) => {
      const { templateId, version, form } = payload;
      const checked = await hubShareCheck(state, deps, { templateId, version, form });
      if (!checked.ok) return checked;
      const { document, problems } = checked.value;
      if (problems.length > 0 || !document)
        return err(hubInvalid(problems.length > 0 ? problems : [{ path: '', rule: 'schema' }]));
      state.acknowledgements.push({ templateId, at: payload.acknowledgedAt });
      const handle = await deps.settings.set(HUB_HANDLE_SETTING, form.handle, context);
      if (!handle.ok) return handle;
      const sent = reach(deps, options);
      if (!sent.ok) return sent;
      const allowed = limit(state, options, 'publish');
      if (!allowed.ok) return allowed;
      const view: HubSubmissionView = {
        id: fakeUlid<'HubSubmission'>(SUBMISSION_KIND, 100 + state.sent.publish),
        hubId: document.id,
        version: document.version,
        templateId,
        templateVersion: version,
        state: 'open',
        createdAt: deps.now(),
        checkedAt: null,
      };
      state.submissions.push(view);
      return ok({ result: view });
    },
  });

  const fork = defineCommand({
    name: HUB_COMMANDS.fork,
    payload: hubCommandPayloads[HUB_COMMANDS.fork],
    sideEffect: 'write',
    project: appWide,
    handle: async (payload, context) => {
      const gate = reach(deps, options);
      if (!gate.ok) return gate;
      const entry = state.entries.find((item) => item.id === payload.hubId);
      const file = state.files.get(payload.hubId);
      if (!entry || !file) return err(HubNotFound());
      if (file.kind === 'hidden') return err(HubHidden());
      if (file.kind === 'newer') return err(HubUnsupportedFormat({ formatVersion: file.formatVersion }));
      if (entry.sha256 !== payload.sha256 || entry.version !== payload.version) return err(HubIntegrity());
      const { document } = file;
      const now = deps.now();
      const built = fromHubTemplate(document, payload.templateId, now);
      if (!built.ok) return built;
      deps.templates.create(built.value, document.name, HUB_COMMANDS.fork, context.source, {
        provenance: {
          kind: 'hub',
          hubId: document.id,
          version: document.version,
          handle: document.handle,
          licence: document.licence,
          forkedAt: now,
          removed: false,
        },
      });
      state.forks.set(payload.hubId, payload.templateId);
      return ok({
        result: { templateId: payload.templateId, version: 1 },
        inverse: {
          name: TEMPLATE_COMMANDS.discard,
          payload: { projectId: null, templateId: payload.templateId },
        },
      });
    },
  });

  const rate = defineCommand({
    name: HUB_COMMANDS.rate,
    payload: hubCommandPayloads[HUB_COMMANDS.rate],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    project: appWide,
    handle: async ({ hubId, stars }) => {
      const gate = reach(deps, options);
      if (!gate.ok) return gate;
      const file = state.files.get(hubId);
      if (!file || !state.entries.some((item) => item.id === hubId)) return err(HubNotFound());
      if (file.kind === 'hidden') return err(HubHidden());
      const allowed = limit(state, options, 'rate');
      if (!allowed.ok) return allowed;
      const rating = rerate(state, hubId, stars);
      return ok({ result: { stars, count: rating.count, mean: rating.mean } });
    },
  });

  const report = defineCommand({
    name: HUB_COMMANDS.report,
    payload: hubCommandPayloads[HUB_COMMANDS.report],
    sideEffect: 'external',
    sources: PERSON_SOURCES,
    project: appWide,
    handle: async ({ hubId }) => {
      const gate = reach(deps, options);
      if (!gate.ok) return gate;
      if (!state.entries.some((item) => item.id === hubId)) return err(HubNotFound());
      const allowed = limit(state, options, 'report');
      if (!allowed.ok) return allowed;
      return ok({ result: { issue: 400 + state.sent.report } });
    },
  });

  const openShare = defineCommand({
    name: HUB_COMMANDS.openShare,
    payload: hubCommandPayloads[HUB_COMMANDS.openShare],
    sideEffect: 'read',
    project: appWide,
    handle: ({ templateId, version }) => {
      deps.events.emit('ui.action', {
        action: HUB_COMMANDS.openShare,
        args: { templateId, ...(version !== undefined ? { version: String(version) } : {}) },
      });
      return ok({ result: { opened: true as const } });
    },
  });

  return [publish, fork, rate, report, openShare];
}

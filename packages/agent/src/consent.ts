// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Consent for uploads of the user's media (PRD G9, packages/vision/SPEC.md
 * "Consent"). An upload declares uploads or is an `external` tool using a cloud module. The
 * first one always asks with a consent card (Allow once, Always allow, Don't
 * send). A standing "Always allow" turns each later upload into an approval
 * logged for that call, never a silent one. It can be taken back
 * (consentsService, appContract.consents): the store is read for every
 * upload, so the next one asks again, also in a run already going.
 *
 * A standing consent covers one module, and one kind of media when the tool names it (`permission.uploads.media`,
 * EAR1-I5): "Always allow" for vision's frames never sends sound through vision. A named kind's consent is kept
 * under `consentKey` (`vision.audio`), so it asks the first time on its own, is revoked on its own, and leaves the
 * module's consent, which background work reads, as it was.
 *
 * EAR1-R3: an upload tool that asks every time (`alwaysAsk`, audio.cloudCritique) shows its card for every call
 * that would send something: no standing consent (`vision.audio` included) and no reference rule answers for it, and
 * its card offers Allow once and Don't send only. A call that names its media by id names it on the card through
 * `uploadNames` (the asset's file name, the artifact's label, the template's name), never by a path.
 *
 * A reference's frames never ask: sending them is part of making a template
 * (the owner's call, 2026-10-30). Each is still an approval logged for its
 * call, like a standing consent's. Nor does a call that can't send anything:
 * its module's chain has no cloud model now, or none of the user's files it
 * names exists (a model that mistyped a path gets the tool's own error).
 */
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  attemptAsync,
  newId,
  UPLOAD_CONSENTS_SETTING,
  type ConsentsService,
  type SettingsStore,
  type UploadMediaKind,
  type UploadSource,
} from '@taalcut/core';
import type { ToolAuthorizeRequest, ToolDecision, ToolDescriptor } from '@taalcut/tools';
import type { EventPayloads, UploadScope } from './events';
import type { ConsentStore, UploadConsent } from './ports';
import type { RunLog } from './run-log';
import { approvalFor } from './state';

export interface ConsentDeps {
  readonly consents: ConsentStore;
  /** Cloud providers a module may send to right now (its model chain). Default: none known. */
  readonly cloudProviders?: (module: string) => readonly string[];
  /**
   * The app's scratch folder, where a template's breakdown keeps the reel and the frames it makes of it: a file
   * inside it is a reference. Without it, only the reel file a run started from is.
   */
  readonly scratchRoot?: string;
  /** Classifies an uploaded path as the user's media or a reference file. Default: inside `scratchRoot`, or the run's reel file. */
  readonly sourceOf?: (file: string) => UploadSource;
  /** Whether a file a call names is there. Default: every file is, so the card asks. */
  readonly fileExists?: (file: string) => Promise<boolean>;
  /**
   * HFW1: whether a tool's upload is its own pictures for the run's model (its spec's `images` hook, such as
   * workspace.renderOver's stills over the person's video), and whether a module's chain sees images. Such a tool
   * sends nothing to a chain where no model sees images: the model reads its words. Unwired, the card asks.
   */
  readonly sendsPictures?: (tool: string) => boolean;
  readonly seesImages?: (module: string) => boolean;
  /**
   * EAR1-R3: what a call that names its media by id rather than path would send, in words for its card: a library
   * asset's file name, an artifact's label, a template's name for its reel. Plain names, never paths; listed after the
   * call's files as the person's own media. Unwired, failing or empty: the card names none.
   */
  readonly uploadNames?: (call: {
    readonly tool: string;
    readonly input: unknown;
  }) => Promise<readonly string[]>;
}

/** Upload declarations apply even when a tool also writes an editable local result. */
export function isUpload(tool: Pick<ToolDescriptor, 'sideEffect' | 'permission'>): boolean {
  return (
    (tool.sideEffect === 'external' || tool.permission.uploads !== undefined) &&
    (tool.permission.cloudModules?.length ?? 0) > 0
  );
}

export function createMemoryConsentStore(): ConsentStore {
  const consents = new Map<string, UploadConsent>();
  return {
    get: async (module) => consents.get(module),
    grant: async (consent) => void consents.set(consent.module, consent),
    list: async () => [...consents.values()],
    revoke: async (module) => consents.delete(module),
  };
}

/** Standing consents in Settings, by cloud module (the library's settings table in the app); defined in core. */
export { UPLOAD_CONSENTS_SETTING };

/** Where a standing consent is kept: the module, or `module.kind` for a kind of media with its own (EAR1-I5). */
export function consentKey(module: string, media?: UploadMediaKind): string {
  return media ? `${module}.${media}` : module;
}

/** The consent store the app uses: one Settings entry. A revoke that can't be written fails, it never pretends. */
export function createSettingsConsentStore(settings: SettingsStore): ConsentStore {
  const all = async () => {
    const stored = await settings.get(UPLOAD_CONSENTS_SETTING);
    return stored.ok ? stored.value : {};
  };
  return {
    get: async (module) => (await all())[module],
    async grant(consent) {
      await settings.set(UPLOAD_CONSENTS_SETTING, {
        ...(await all()),
        [consent.module]: { ...consent, providers: [...consent.providers] },
      });
    },
    list: async () => Object.values(await all()),
    async revoke(module) {
      const { [module]: gone, ...rest } = await all();
      if (!gone) return false;
      const written =
        Object.keys(rest).length === 0
          ? await settings.reset(UPLOAD_CONSENTS_SETTING)
          : await settings.set(UPLOAD_CONSENTS_SETTING, rest);
      if (!written.ok) throw written.error;
      return true;
    },
  };
}

/** appContract.consents over a consent store: list by module name, revoke (idempotent). */
export function consentsService(store: ConsentStore): ConsentsService {
  return {
    list: () =>
      attemptAsync(async () =>
        (await store.list())
          .map(({ module, providers, grantedAt }) => ({ module, providers: [...providers], grantedAt }))
          .sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0)),
      ),
    revoke: ({ module }) => attemptAsync(async () => ({ module, revoked: await store.revoke(module) })),
  };
}

/**
 * The approval gate for uploads. Runs after the budget gate, at every autonomy level. With Local only on now
 * (`localOnly`), the model client sends only to models on this Mac: nothing leaves, so the call's approval is
 * logged and granted at once, never asked (P3-B10).
 */
export async function consentGate(
  deps: ConsentDeps,
  log: RunLog,
  request: ToolAuthorizeRequest,
  localOnly = false,
): Promise<ToolDecision> {
  // Any approval for this call counts, newest first: after a crash the restart question wins.
  const approval = approvalFor(log.state, request.callId, ['consent', 'tool']);
  if (approval?.status === 'granted') return { kind: 'allow', approvalId: approval.request.requestId };
  if (approval?.status === 'denied') return { kind: 'deny', reason: 'The user chose not to send this.' };
  if (approval) return { kind: 'defer', reason: 'Waiting for the user to allow the upload.' };

  const scope = await uploadScope(deps, log, request);
  const upload = localOnly ? { ...scope, providers: [] } : scope;
  const answer = await answerAtOnce(deps, upload, localOnly, request.tool);
  const asked = consentAsk(request, answer?.reason ?? 'upload', upload);
  if (answer) return grantAtOnce(log, { ...asked, ...answer.marks });
  const logged = await log.append(['approval.requested', asked]);
  return logged.ok
    ? { kind: 'defer', reason: 'Asked the user to allow the upload.' }
    : { kind: 'deny', reason: 'Could not record the consent request.' };
}

type ConsentAsk = EventPayloads['approval.requested'];

interface AtOnce {
  readonly reason:
    'local-only' | 'reference' | 'on-device' | 'no-pictures' | 'missing-file' | 'standing-consent';
  readonly marks: Pick<ConsentAsk, 'localOnly' | 'reference' | 'missingFiles' | 'standingConsentIds'>;
}

/**
 * Why the call needs no card, if it doesn't. A tool that asks every time (EAR1-R3) is answered at once only when
 * nothing of the person's can leave: never by a standing consent or the reference rule.
 */
async function answerAtOnce(
  deps: ConsentDeps,
  upload: UploadScope,
  localOnly: boolean,
  { name: tool, alwaysAsk }: Pick<ToolDescriptor, 'name' | 'alwaysAsk'>,
): Promise<AtOnce | undefined> {
  if (localOnly) return { reason: 'local-only', marks: { localOnly: true } };
  if (!alwaysAsk && isReferenceOnly(upload)) return { reason: 'reference', marks: { reference: true } };
  // The module's chain has no cloud model now, so the call runs on this Mac (an unwired list knows nothing: it asks).
  if (deps.cloudProviders && upload.providers.length === 0)
    return { reason: 'on-device', marks: { localOnly: true } };
  // Its pictures are all it sends, and no model in the chain sees images: they stay on this Mac.
  const sees = deps.seesImages;
  if (deps.sendsPictures?.(tool) && sees && !upload.modules.some((module) => sees(module)))
    return { reason: 'no-pictures', marks: { localOnly: true } };
  const missing = await missingUserFiles(deps, upload);
  if (missing) return { reason: 'missing-file', marks: { missingFiles: missing } };
  if (alwaysAsk) return undefined;
  const standing = await standingConsents(deps.consents, upload);
  return standing
    ? { reason: 'standing-consent', marks: { standingConsentIds: standing.map((c) => c.id) } }
    : undefined;
}

/**
 * The user's files the call names, when it names some and none of them is there; else undefined. A relative path
 * counts as there: a tool may find it from somewhere else.
 */
async function missingUserFiles(deps: ConsentDeps, upload: UploadScope): Promise<string[] | undefined> {
  const exists = deps.fileExists;
  if (!exists) return undefined;
  const mine = upload.files.filter((_, i) => upload.sources?.[i] !== 'reference');
  if (mine.length === 0) return undefined;
  for (const file of mine) if (!isAbsolute(file) || (await exists(file))) return undefined;
  return mine;
}

function consentAsk(request: ToolAuthorizeRequest, reason: string, upload: UploadScope): ConsentAsk {
  return {
    requestId: newId<'Approval'>(),
    kind: 'consent',
    toolCallIds: [request.callId],
    reason,
    upload,
    ...(request.tool.alwaysAsk ? { alwaysAsk: true } : {}),
    ...(request.estimate
      ? { estimate: { usd: request.estimate.usd, tokens: request.estimate.tokens ?? 0 } }
      : {}),
  };
}

/** Only a reference's frames: at least one file, and every one of them a reference. */
function isReferenceOnly(upload: UploadScope): boolean {
  return upload.files.length > 0 && upload.sources?.every((source) => source === 'reference') === true;
}

/** Answered without asking (a reference, a standing consent, or Local only): the request and its grant, logged together. */
async function grantAtOnce(log: RunLog, asked: ConsentAsk): Promise<ToolDecision> {
  const { requestId, standingConsentIds } = asked;
  const logged = await log.append(
    ['approval.requested', asked],
    ['approval.granted', { requestId, ...(standingConsentIds ? { consentIds: standingConsentIds } : {}) }],
  );
  return logged.ok
    ? { kind: 'allow', approvalId: requestId }
    : { kind: 'deny', reason: 'Could not record the upload approval.' };
}

/**
 * "Always allow": a standing consent per module (and named kind), covering the providers the card showed. None for a
 * tool that asks every time: its card has no Always allow, and a `remember` sent anyway counts as Allow once.
 */
export async function rememberConsent(
  store: ConsentStore,
  { upload, alwaysAsk }: Pick<ConsentAsk, 'upload' | 'alwaysAsk'>,
  now: number,
): Promise<string[]> {
  if (!upload || alwaysAsk) return [];
  const ids: string[] = [];
  for (const module of upload.modules) {
    const consent: UploadConsent = {
      id: newId<'Consent'>(),
      module: consentKey(module, upload.media),
      providers: upload.providers,
      grantedAt: now,
    };
    await store.grant(consent);
    ids.push(consent.id);
  }
  return ids;
}

function defaultSourceOf(deps: ConsentDeps, log: RunLog, file: string): UploadSource {
  if (deps.scratchRoot && isInside(deps.scratchRoot, file)) return 'reference';
  const start = log.state.started?.start;
  if (start?.path === 'reference' && start.reference.kind === 'file' && start.reference.path === file)
    return 'reference';
  return 'user-media';
}

/** An absolute path inside `folder`, after `..` is resolved: a folder named `scratch` elsewhere isn't it. */
function isInside(folder: string, file: string): boolean {
  if (!isAbsolute(file)) return false;
  const path = relative(resolve(folder), resolve(file));
  return path !== '' && !isAbsolute(path) && path.split(sep)[0] !== '..';
}

async function uploadScope(
  deps: ConsentDeps,
  log: RunLog,
  request: ToolAuthorizeRequest,
): Promise<UploadScope> {
  const modules = [...(request.tool.permission.cloudModules ?? [])];
  const providers = [...new Set(modules.flatMap((m) => deps.cloudProviders?.(m) ?? []))].sort();
  const paths = filesIn(request.input);
  const named = await namesIn(deps, request);
  const files = [...paths, ...named];
  const sources: UploadSource[] = [
    ...paths.map((file) => deps.sourceOf?.(file) ?? defaultSourceOf(deps, log, file)),
    // A name stands for the person's own media, never a reference's file.
    ...named.map(() => 'user-media' as const),
  ];
  const media = request.tool.permission.uploads?.media;
  return { modules, providers, files, sources, ...(media ? { media } : {}) };
}

/** EAR1-R3: the names a call's ids stand for (`uploadNames`). A path given by mistake shows as its file name only. */
async function namesIn(deps: ConsentDeps, request: ToolAuthorizeRequest): Promise<string[]> {
  if (!deps.uploadNames) return [];
  let names: readonly string[];
  try {
    names = await deps.uploadNames({ tool: request.tool.name, input: request.input });
  } catch {
    return [];
  }
  return names.map((name) => (isAbsolute(name) ? basename(name) : name)).filter((name) => name !== '');
}

/** Every module has a standing consent for this kind of media that covers each provider it may send to now. */
async function standingConsents(
  store: ConsentStore,
  upload: UploadScope,
): Promise<UploadConsent[] | undefined> {
  const found: UploadConsent[] = [];
  for (const module of upload.modules) {
    const consent = await store.get(consentKey(module, upload.media));
    if (!consent || !upload.providers.every((p) => consent.providers.includes(p))) return undefined;
    found.push(consent);
  }
  return found;
}

/** Paths in the call's input (`path`, `file`, `paths`, `files`), for the card. */
function filesIn(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const files: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!/^(path|file)s?$/.test(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') files.push(item);
  }
  return files;
}

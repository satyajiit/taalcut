// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every package's index stages for the jobs process's pipeline (P2-L13, the
 * library SPEC's table): library.hash, media's normalise, previews and proxy,
 * vision's shots, analysis, embeddings and descriptions, audio's language,
 * transcript and beats, and vision's library-wide near-duplicate pass. The
 * library never imports media, vision or audio; the stages are data listed
 * here.
 *
 * Vision's stages read three things that change while the app runs: the
 * hardware tier (frames per shot), the languages to read on screen (the
 * asset's spoken language, the Mac's language and English) and where
 * descriptions run. Descriptions stay
 * on this Mac ('local') unless the user gave vision a standing upload consent
 * and local-only mode is off: background jobs never show a consent card, and
 * the agent's background-models server checks the consent again per call.
 */
import {
  createToken,
  LOCAL_ONLY_SETTING,
  ModelProfileStoreToken,
  SettingsStoreToken,
  UPLOAD_CONSENTS_SETTING,
  type Container,
  type DuplicatePassDefinition,
  type IndexStageDefinition,
  type SettingsStore,
} from '@taalcut/core';
import { join } from 'node:path';
import { createAudioIndexStages, storedLanguage } from '@taalcut/audio';
import { installedComponentDirSync } from '@taalcut/jobs';
import { libraryHashStage, MODEL_MISSING, placeStage } from '@taalcut/library';
import { createMediaIndexStages } from '@taalcut/media';
import { componentsFor, llamaCppRuntimeSpec } from '@taalcut/models';
import {
  createVisionIndexStages,
  EMBEDDING_COMPONENT,
  planOcrBackends,
  visionDuplicatePass,
  type Tier,
} from '@taalcut/vision';
import { hostPlatform } from '../../platform';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ONNXRUNTIME_COMPONENT } from '../component-natives';
import { managedNativesOnly } from './dev-components';
import { AUDIO_COMPONENTS } from './audio';
import { describerReader, type LocalDescriber } from './describer-chain';
import { macHardware } from './hardware';

export interface IndexStageWiring {
  readonly stages: readonly IndexStageDefinition[];
  readonly duplicates?: DuplicatePassDefinition;
  /** Re-reads the tier, the description placement and the installed models (at start, then now and then). */
  refresh(): Promise<void>;
  /** A reason while a stage's on-device model isn't installed: its rows wait for it instead of failing. */
  notReady?(stage: string): string | undefined;
  /** Stops the periodic refresh, if any. */
  stop?(): void;
}

/** The jobs root registers the full set; without it the pipeline runs library.hash alone (tests). */
export const IndexStagesToken = createToken<IndexStageWiring>('desktop.indexStages');

/** The v1 languages (D8) OCR reads besides the spoken one. */
const OCR_LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;

/** The Mac's language, when it is one of the four, and English. */
export function screenLanguages(locale: string = Intl.DateTimeFormat().resolvedOptions().locale): string[] {
  const base = locale.toLowerCase().split('-')[0] ?? 'en';
  const own = OCR_LANGUAGES.find((tag) => tag.toLowerCase().split('-')[0] === base);
  return [...new Set([...(own ? [own] : []), 'en'])];
}

export interface IndexStageOptions {
  readonly tier: () => Promise<Tier>;
  readonly settings: () => SettingsStore;
  /** Whether a component is installed (read on refresh). Without it, no stage waits for a model. */
  readonly installed?: (componentId: string) => boolean;
  /**
   * Runtimes come from components only (a packaged app, or a development run installing from a local release;
   * component-natives.ts): the stages wait for ONNX Runtime's component too. Else a checkout falls back to
   * node_modules' binding.
   */
  readonly managedRuntimes?: boolean;
  /**
   * The component vision.ocr's Latin reader needs on this machine: PP-OCRv5 Latin where there is no Apple Vision
   * (Linux, Windows); undefined on a Mac, whose Vision ships with the OS (UX3-IDX).
   */
  readonly ocrComponent?: string;
  /**
   * Who answers a description on this Mac (describer-chain.ts): it waits for the bundled model only when that is
   * the one that describes. Undefined (or unread): the bundled model, on a tier that has one.
   */
  readonly describer?: (tier: Tier) => Promise<LocalDescriber | undefined>;
}

/**
 * The stages that run EmbeddingGemma 2: frame, transcript (IX-E1), on-screen text (IX-O5) and description vectors.
 * vision.describe stores its descriptions' vectors in the same job: without the model a cloud description would upload
 * the frames and then fail (IX-F1), so it waits too, as it did behind vision.embed before round IX.
 */
const EMBEDDING_STAGES: readonly string[] = [
  'vision.embed',
  'vision.embedText',
  'vision.embedOcr',
  'vision.describe',
];

/** The OCR stage: it waits for its PP-OCR model where that reads Latin text (UX3-IDX). */
const OCR_STAGE = 'vision.ocr';

/** The describe stage: on this Mac it also waits for the model that describes (LIB1-FIX). */
const DESCRIBE_STAGE = 'vision.describe';

/** What a stage can't run without: each entry is one component, or several of which any one will do. */
type Needs = readonly (readonly string[])[];

/**
 * What the on-device describer needs on a tier: the runtime (any of its builds: the Mac's, or a Linux GPU build) and
 * the weights and projector of the model that reads frames. Nothing where no such model fits the tier (8 GB Macs get
 * a text-only model): there a local description skips once with `no_local_model` instead of waiting for ever.
 */
export function describerNeeds(tier: Tier): Needs {
  const spec = llamaCppRuntimeSpec(tier);
  const ids = componentsFor({ ...spec, models: spec.models.filter((model) => model.vision) }, tier);
  if (ids.length === 0) return [];
  const builds = Object.values(spec.runtimeBuilds ?? {}).filter((id): id is string => id !== undefined);
  return [[spec.runtimeComponentId, ...builds], ...ids.slice(1).map((id) => [id])];
}

/** The describing model's weights on a tier, the component a held description names; none where there is no such model. */
export function describerModel(tier: Tier): string | undefined {
  return describerNeeds(tier)[1]?.[0];
}

/** Where the stages run now, re-read on refresh. */
interface Placement {
  readonly tier: Tier;
  readonly describe: 'local' | 'cloud';
  /** The bundled model describes here, not a server of the person's own (describer-chain.ts). */
  readonly bundled: boolean;
}

/**
 * The components each model-bound stage can't run without. A description on this Mac waits for the describing model
 * as it waits for EmbeddingGemma: one that ran without it answered `not_yet` and never ran again (LIB1-FIX). A cloud
 * description never waits for a local model, nor one that the person's own server (Ollama, LM Studio) answers.
 */
function needsOf(stage: string, options: IndexStageOptions, now: Placement): Needs {
  const runtime = options.managedRuntimes ? [[ONNXRUNTIME_COMPONENT]] : [];
  const embedding = [[EMBEDDING_COMPONENT], ...runtime];
  if (stage === DESCRIBE_STAGE)
    return now.describe === 'local' && now.bundled ? [...embedding, ...describerNeeds(now.tier)] : embedding;
  if (EMBEDDING_STAGES.includes(stage)) return embedding;
  if (stage === OCR_STAGE && options.ocrComponent) return [[options.ocrComponent], ...runtime];
  return [];
}

/** Every stage that names its models up front. */
const UP_FRONT_STAGES: readonly string[] = [...EMBEDDING_STAGES, OCR_STAGE];

export function indexStageWiring(options: IndexStageOptions): IndexStageWiring {
  let tier: Tier = 'recommended';
  let placement: 'local' | 'cloud' = 'local';
  let blocked = new Set<string>();
  // Parakeet's transcript kind only while its model is installed (the job falls back to whisper without the helper).
  let parakeet = false;
  const languages = screenLanguages();
  const vision = createVisionIndexStages({
    // A getter: the tier is probed after the stages exist, and framesForShot reads it per job.
    get tier() {
      return tier;
    },
    ocrLanguages: () => languages,
    // vision.ocr reads the asset's spoken language too (it needs audio.language): Hindi speech sends frames to
    // PP-OCR's Devanagari model, which the app language alone reaches only on a Hindi Mac.
    spokenLanguage: (view) => {
      const identified = storedLanguage(view);
      return identified && !identified.silent ? (identified.detected.language ?? undefined) : undefined;
    },
    placement: () => placement,
  });
  return {
    stages: [
      libraryHashStage,
      ...createMediaIndexStages(),
      // LIB1-PLACE: where it was shot, after normalise read its coordinates and time.
      placeStage,
      ...vision,
      ...createAudioIndexStages({ parakeetReady: () => parakeet }),
    ],
    duplicates: visionDuplicatePass,
    notReady: (stage) => (blocked.has(stage) ? MODEL_MISSING : undefined),
    async refresh() {
      tier = await options.tier();
      const settings = options.settings();
      const [consents, localOnly] = await Promise.all([
        settings.get(UPLOAD_CONSENTS_SETTING),
        settings.get(LOCAL_ONLY_SETTING),
      ]);
      const consented = consents.ok && consents.value.vision !== undefined;
      placement = consented && localOnly.ok && !localOnly.value ? 'cloud' : 'local';
      const installed = options.installed;
      if (installed) {
        // Read last: the describer's needs follow the tier, the placement and the model that describes.
        const describer = placement === 'local' ? await options.describer?.(tier) : undefined;
        const now = {
          tier,
          describe: placement,
          bundled: describer === undefined || describer === 'bundled',
        };
        const missing = (needs: Needs) => needs.some((anyOf) => !anyOf.some(installed));
        blocked = new Set(UP_FRONT_STAGES.filter((stage) => missing(needsOf(stage, options, now))));
        parakeet = installed(AUDIO_COMPONENTS.parakeet.id);
      }
    },
  };
}

/** The component the OCR stage waits for here, as the vision root plans its Latin reader (none on a Mac). */
export function ocrComponentOf(platform: NodeJS.Platform): { readonly ocrComponent?: string } {
  const latin = planOcrBackends({ platform, helper: true }).latin;
  return latin === 'apple-vision' ? {} : { ocrComponent: latin.component };
}

/** Re-reads the tier and the placement this often while the app runs (settings change in the agent process). */
const REFRESH_MS = 30_000;

/** Registers the full stage list, refreshed every 30 s and stopped with the container. */
export function registerIndexStages(
  container: Container,
  config: Pick<UtilityConfig, 'userData'> & { readonly packaged?: boolean },
  hardware = macHardware(config.userData),
): void {
  const componentsRoot = join(config.userData, 'components');
  container.factory(
    IndexStagesToken,
    ({ settings, profiles }) => {
      const wiring = indexStageWiring({
        tier: async () => {
          try {
            return (await hardware()).assessment.tier;
          } catch {
            return 'minimum';
          }
        },
        settings: () => settings,
        describer: describerReader(profiles, settings),
        installed: (id) => installedComponentDirSync(componentsRoot, id) !== undefined,
        managedRuntimes: managedNativesOnly(config.packaged ?? false),
        ...ocrComponentOf(hostPlatform().name),
      });
      const timer = setInterval(() => void wiring.refresh(), REFRESH_MS);
      timer.unref();
      return { ...wiring, stop: () => clearInterval(timer) };
    },
    {
      deps: { settings: SettingsStoreToken, profiles: ModelProfileStoreToken },
      dispose: (wiring) => wiring.stop?.(),
    },
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the render engine is built from. The render process's composition
 * root fills it (apps/desktop/src/utility/roots/render-root.ts); tests fill
 * it with fakes that honour the same ports.
 */
import type { FaceBoxesDump } from '../qa/checks/faces';
import type {
  AsyncResult,
  Clock,
  ComputeFallbackEvent,
  DuckingPlanner,
  EventBus,
  RenderStore,
  Result,
  SettingsStore,
  SoundListener,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { AssetFiles, ReferenceAudioSource, TimelineAccess, TranscriptSource } from '../ports';
import type { RenderContentCredentials } from '../credentials';
import type { CubeApplier } from '../grade';
import type { GeneratedMusic } from '../music/paths';
import type { GradeLutSource, ProvenanceLookup, SubjectTrackSource } from '../ports-phase3';
import type { StyleSource } from '../style/resolve-style';
import type { StylePacingSource } from '../qa/checks/style-pacing';
import type { SlotMatchSource } from '../qa/checks/slot-match/facts';
import type { TextMeasurer } from '../types';

/** The render folders (apps/desktop/src/shared/render-paths.ts gives the app's). */
export interface RenderFolders {
  /** app://preview/<token>/… is <preview>/<token>/…. */
  readonly preview: string;
  /** One folder per running export, removed when it ends. */
  readonly work: string;
  /** Conformed clip segments, content-addressed. */
  readonly conform: string;
  /** Finished renders: <renders>/<projectId>/<renderId>.mp4 (finalizeRender writes them). */
  readonly renders: string;
}

export interface RenderEngineDeps {
  readonly store: RenderStore;
  readonly timelines: TimelineAccess;
  readonly assets: AssetFiles;
  readonly transcripts?: TranscriptSource;
  /**
   * Path d (REF1): the reel each template keeps, for the export's mix, the preview's sound and the export
   * options' link and credit. Absent: no reel is here, so path d stops at preflight with render.media_missing.
   */
  readonly referenceAudio?: ReferenceAudioSource;
  /** Export settings (render.setExportPreset); optional in tests. */
  readonly settings?: SettingsStore;
  readonly media: MediaContext;
  /**
   * The pinned chrome-headless-shell (HEADLESS_SHELL): the installed component, or the
   * development cache in a checkout. Resolved per export, so an install mid-session is picked up.
   */
  readonly shell: () => Promise<Result<string>>;
  /** The bundled caption fonts (resolveFontDir). */
  readonly fontsDir: string;
  /** Built once per process on first use (harfbuzz loads its WASM then). */
  readonly measurer: () => Promise<TextMeasurer>;
  readonly folders: RenderFolders;
  readonly clock: Clock;
  readonly events: Pick<EventBus, 'emit'>;
  /** Where compute.fallback goes; default events.emit('compute.fallback', …). */
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Producer workers; 'auto' lets HyperFrames size it to the machine. */
  readonly workers?: number | 'auto';
  readonly log?: (line: string) => void;
  /**
   * HFW1: the app's user-data folder, where each project's workspace blobs are (`workspaces/<projectId>/blobs`);
   * absent, composition graphics are left out of previews, stills and exports (with a warning).
   */
  readonly workspaceRoot?: string;
  // Phase 3: each optional, each with an "unavailable" behaviour of its stage (SPEC P3.15).
  /** P3-V2: subject tracks; without them reframed shots get the centre crop and the export one warning. */
  readonly subjectTracks?: SubjectTrackSource;
  /**
   * FRM1-OVL, gates and evals only (a test build's TAALCUT_RENDER_BOXES_DIR): what graphicCoversFace saw on each
   * export, so a face detector run on the exported file can be checked against the boxes render drew.
   */
  readonly onFaceBoxes?: (
    render: { readonly renderId: string; readonly round: number },
    dump: FaceBoxesDump,
  ) => void | Promise<void>;
  /** P3-V10: the Style a timeline renders with. */
  readonly styles?: StyleSource;
  /** P3-V17: grade LUTs per clip; without them a graded Style renders ungraded with a warning. */
  readonly grades?: GradeLutSource;
  /** P3-V17: the mac helper's `video.applyCube` (null off macOS or without the helper: the CPU route). */
  readonly cubeApplier?: () => Promise<CubeApplier | null>;
  /** P3-V7: where assets came from, for the AI inventory. */
  readonly provenance?: ProvenanceLookup;
  /** P3-V6: audio's ducking planner (core's DuckingPlanner). */
  readonly ducking?: DuckingPlanner;
  /**
   * P3-V6 path c: the warped 48 kHz FLAC a generated-music choice names (its `warpedKey` in the media cache),
   * or null when it is gone; without it a generated-music export stops at preflight (`render.media_missing`).
   */
  readonly generatedMusic?: (choice: GeneratedMusic) => AsyncResult<string | null>;
  /** P3-V7: the c2pa sidecar's signing and reading; without it an export with credentials on stops at signing. */
  readonly credentials?: RenderContentCredentials;
  /** The app's version, for the manifest's claim generator (default 'development'). */
  readonly appVersion?: string;
  /** LRN1-STY: the pacing band of the set a project is made like; without it stylePacing is skipped. */
  readonly stylePacing?: StylePacingSource;
  /** AGT2-MATCH: a draft's template and the library's word on its shots; without it the slot checks are skipped. */
  readonly slotMatch?: SlotMatchSource;
  /**
   * EAR1-A2: core's SoundListener (an `audio.listen.analyse` job in the jobs process: no ONNX session opens here);
   * without it the sound checks (soundOnCuts, soundClean, soundCritique) are skipped.
   */
  readonly listener?: SoundListener;
}

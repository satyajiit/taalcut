// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The no-helper subject detector (FRM1-SUB): body poses, faces and people in one upright RGB frame, on ONNX Runtime
 * (GPU first; the runtime logs a CPU fallback as `compute.fallback`). Poses: RTMO-s (COCO keypoints) on the frame
 * letterboxed into 640 × 640. People: YOLOX-Nano on the frame letterboxed into its square. Faces are the poses' faces
 * (heads.ts `faceOfPose`): no face model runs. Boxes and keypoints come back as fractions of the frame, origin top
 * left, clipped to it. Both sessions open on the first call; a failed open is tried again on the next.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type TaalcutError,
} from '@taalcut/core';
import { SubjectDetectFailed, VisionModelMissing } from '../errors';
import type { OnnxRuntime, OnnxSession } from '../onnx/ort';
import { nms, toFraction } from './boxes';
import { faceOfPose } from './heads';
import { letterbox, type RgbFrame } from './letterbox';
import {
  SUBJECT_TUNING,
  SUBJECTS_ONNX_COMPONENT,
  SUBJECTS_OPERATION,
  SUBJECTS_PERSON_FILE,
  SUBJECTS_PERSON_SIZE,
  SUBJECTS_POSE_FILE,
  type SubjectTuning,
} from './model';
import { decodeRtmo, RTMO_OUTPUTS, RTMO_PAD, RTMO_SIZE } from './rtmo';
import type { FrameSubjects } from './found';
import { decodeYolox, YOLOX_PAD } from './yolox';

export type { DetectedFace, DetectedPerson, DetectedPose, FrameSubjects, PoseKeypoint } from './found';

export interface SubjectDetector {
  detect(frame: RgbFrame, signal?: AbortSignal): AsyncResult<FrameSubjects>;
  /** Where each model runs, once opened. */
  backends(): { readonly poses?: ComputeBackend; readonly people?: ComputeBackend };
  release(): Promise<void>;
}

export interface OnnxSubjectDetectorOptions {
  readonly runtime: OnnxRuntime;
  /** The installed `subjects-onnx` component's folder. */
  readonly modelDir: string;
  /** Overrides of the tuned thresholds (the eval's sweeps). */
  readonly tuning?: Partial<SubjectTuning>;
}

interface Sessions {
  readonly poses: OnnxSession;
  readonly people: OnnxSession;
}

const failed = (detail: string) => err(SubjectDetectFailed(undefined, { detail: detail.slice(0, 500) }));

/** A run's error: cancellation stays cancellation, anything else is this detector failing. */
const runError = (error: TaalcutError) =>
  error.code === 'core.cancelled' ? err(error) : failed(`${error.code}: ${error.detail ?? ''}`);

export function createOnnxSubjectDetector(options: OnnxSubjectDetectorOptions): SubjectDetector {
  const tuning: SubjectTuning = { ...SUBJECT_TUNING, ...options.tuning };
  let opening: Promise<Sessions | TaalcutError> | undefined;
  let backends: { poses?: ComputeBackend; people?: ComputeBackend } = {};

  const openOne = async (
    file: string,
    operation: string,
    outputs: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<OnnxSession> => {
    const path = join(options.modelDir, file);
    const present = await access(path).then(
      () => true,
      () => false,
    );
    if (!present)
      return err(VisionModelMissing({ component: SUBJECTS_ONNX_COMPONENT }, { detail: `no ${file}` }));
    const opened = await options.runtime.openSession(path, { operation, ...(signal ? { signal } : {}) });
    if (!opened.ok)
      // The runtime's own code names OCR, its first user: a session that won't open is this detector failing.
      return opened.error.code === 'core.cancelled'
        ? opened
        : failed(`${file}: ${opened.error.code}: ${opened.error.detail ?? ''}`);
    const missing = outputs.filter((name) => !opened.value.outputNames.includes(name));
    if (opened.value.inputNames.length === 0 || missing.length > 0) {
      await opened.value.release();
      return failed(`${file}: unexpected graph: ${opened.value.inputNames} → ${opened.value.outputNames}`);
    }
    return opened;
  };

  const open = async (signal?: AbortSignal): Promise<Sessions | TaalcutError> => {
    const poses = await openOne(SUBJECTS_POSE_FILE, SUBJECTS_OPERATION.poses, RTMO_OUTPUTS, signal);
    if (!poses.ok) return poses.error;
    const people = await openOne(SUBJECTS_PERSON_FILE, SUBJECTS_OPERATION.people, [], signal);
    if (!people.ok) {
      await poses.value.release();
      return people.error;
    }
    return { poses: poses.value, people: people.value };
  };

  const sessions = async (signal?: AbortSignal): AsyncResult<Sessions> => {
    opening ??= open(signal);
    const opened = await opening;
    if ('poses' in opened) return ok(opened);
    opening = undefined;
    return err(opened);
  };

  /** Poses in tensor pixels, and the tensor's scale. */
  const findPoses = async (session: OnnxSession, frame: RgbFrame, signal?: AbortSignal) => {
    const input = letterbox(frame, { width: RTMO_SIZE, height: RTMO_SIZE, pad: RTMO_PAD });
    const run = await session.run({ [session.inputNames[0]!]: input }, signal);
    if (!run.ok) return runError(run.error);
    const decoded = decodeRtmo(run.value, { scoreThreshold: tuning.poseScore });
    if (typeof decoded === 'string') return failed(`${SUBJECTS_POSE_FILE}: ${decoded}`);
    return ok({ found: nms(decoded, tuning.poseNms, tuning.limit), scale: input.scale });
  };

  const findPeople = async (session: OnnxSession, frame: RgbFrame, signal?: AbortSignal) => {
    const size = SUBJECTS_PERSON_SIZE;
    const input = letterbox(frame, { width: size, height: size, pad: YOLOX_PAD });
    const run = await session.run({ [session.inputNames[0]!]: input }, signal);
    if (!run.ok) return runError(run.error);
    const output = run.value[session.outputNames[0]!];
    if (!output) return failed(`${SUBJECTS_PERSON_FILE}: no output`);
    const decoded = decodeYolox(output, { size, scoreThreshold: tuning.personScore });
    if (typeof decoded === 'string') return failed(`${SUBJECTS_PERSON_FILE}: ${decoded}`);
    return ok({ found: nms(decoded, tuning.personNms, tuning.limit), scale: input.scale });
  };

  return {
    async detect(frame, signal) {
      if (signal?.aborted) return err(CancelledError());
      if (frame.width < 1 || frame.height < 1 || frame.rgb.length !== frame.width * frame.height * 3)
        return failed(`frame is ${frame.width}×${frame.height} but has ${frame.rgb.length} bytes`);
      const opened = await sessions(signal);
      if (!opened.ok) return opened;
      backends = { poses: opened.value.poses.backend, people: opened.value.people.backend };
      const poses = await findPoses(opened.value.poses, frame, signal);
      if (!poses.ok) return poses;
      const people = await findPeople(opened.value.people, frame, signal);
      if (!people.ok) return people;
      const keypoint = (point: { x: number; y: number; score: number }) => ({
        x: Math.min(1, Math.max(0, point.x / poses.value.scale / frame.width)),
        y: Math.min(1, Math.max(0, point.y / poses.value.scale / frame.height)),
        score: Math.min(1, Math.max(0, point.score)),
      });
      const found = poses.value.found.flatMap((pose) => {
        const box = toFraction(pose.box, poses.value.scale, frame);
        return box
          ? [{ box, confidence: Math.min(1, pose.score), keypoints: pose.keypoints.map(keypoint) }]
          : [];
      });
      return ok({
        faces: found.flatMap((pose) => {
          const face = faceOfPose(pose, frame, tuning);
          return face ? [face] : [];
        }),
        people: people.value.found.flatMap((person) => {
          const box = toFraction(person.box, people.value.scale, frame);
          return box ? [{ box, confidence: Math.min(1, person.score) }] : [];
        }),
        poses: found,
      });
    },
    backends: () => backends,
    async release() {
      const pending = opening;
      opening = undefined;
      backends = {};
      const opened = pending ? await pending : undefined;
      if (opened && 'poses' in opened) await Promise.all([opened.poses.release(), opened.people.release()]);
    },
  };
}

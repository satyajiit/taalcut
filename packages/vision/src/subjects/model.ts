// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The no-helper subject detector's component and its tuning (FRM1-SUB). One component holds both graphs: RTMO-s
 * (MMPose, Apache-2.0, trained on COCO person keypoints only) for body poses, and so heads and faces, and YOLOX-Nano
 * (Megvii, Apache-2.0, COCO) for people. No face model: RetinaFace's training data (WIDER FACE) is research-only.
 * Provenance, sizes and sha256: the vision SPEC, "Subjects without the helper", and the component manifest.
 */

/** The component that holds both models, and their files. */
export const SUBJECTS_ONNX_COMPONENT = 'subjects-onnx';
export const SUBJECTS_POSE_FILE = 'rtmo_s_coco.onnx';
export const SUBJECTS_PERSON_FILE = 'yolox_nano.onnx';
/** YOLOX-Nano's fixed square input. */
export const SUBJECTS_PERSON_SIZE = 416;

/** The `compute.fallback` operation names. */
export const SUBJECTS_OPERATION = { poses: 'vision.subjectPoses', people: 'vision.subjectPeople' } as const;

export interface SubjectTuning {
  /** A pose's least person score. */
  readonly poseScore: number;
  /** Poses overlapping a better one by more than this IoU are dropped. */
  readonly poseNms: number;
  /** A keypoint's least score to place and size a head. */
  readonly keypointScore: number;
  /** The nose's or an eye's least score for a pose to have a face. */
  readonly faceKeypointScore: number;
  /** A person's least objectness × class score. */
  readonly personScore: number;
  readonly personNms: number;
  /** At most this many of each, best first (the track keeps 16). */
  readonly limit: number;
}

/**
 * Tuned on the FRM1 subjects set (tools/evals/src/subjects, 90 frames): keypoints from 0.2 place and size the most
 * heads (83/100, against 57 at 0.3 with shoulders required); a face needs its nose or an eye at 0.3, which finds
 * 86/88 faces with 2 on no labelled head; people at 0.4 keep 97% of the labelled heads inside a person box.
 */
export const SUBJECT_TUNING: SubjectTuning = {
  poseScore: 0.3,
  poseNms: 0.45,
  keypointScore: 0.2,
  faceKeypointScore: 0.3,
  personScore: 0.4,
  personNms: 0.45,
  limit: 16,
};

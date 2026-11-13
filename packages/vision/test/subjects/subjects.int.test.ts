// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the real models on one small frame. The fixture (fixtures/subjects/proverbio-2.jpg, 216 × 384) is the
 * frame at 2 s of "Um provérbio russo dito por jovem russa na cidade do Porto Portugal" by Daniel Dias escritor,
 * CC0 (https://commons.wikimedia.org/wiki/File:Um_prov%C3%A9rbio_russo_dito_por_jovem_russa_na_cidade_do_Porto_Portugal.webm),
 * cropped to 9:16 and scaled down: one woman facing the camera, head and upper body.
 *
 * Opt-in: runs when the `subjects-onnx` component is in `TAALCUT_SUBJECTS_ONNX_DIR` or `packages/vision/.cache/
 * subjects-onnx/`, and FFmpeg is there to decode the JPEG; skipped with the reason otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createOrtRuntime } from '../../src/onnx/ort';
import { createOnnxSubjectDetector } from '../../src/subjects/detector';
import { headsFrom } from '../../src/subjects/heads';
import { SUBJECTS_ONNX_COMPONENT, SUBJECTS_PERSON_FILE, SUBJECTS_POSE_FILE } from '../../src/subjects/model';
import { componentDir } from '../helpers/offline';
import { testMedia } from '../helpers/reel';

const FIXTURE = fileURLToPath(new URL('../fixtures/subjects/proverbio-2.jpg', import.meta.url));
const SIZE = { width: 216, height: 384 };
const DIR = componentDir(SUBJECTS_ONNX_COMPONENT, SUBJECTS_POSE_FILE);
const media = await testMedia('subjects');
const skip =
  DIR === undefined || !existsSync(`${DIR}/${SUBJECTS_PERSON_FILE}`)
    ? `no ${SUBJECTS_ONNX_COMPONENT} component (TAALCUT_SUBJECTS_ONNX_DIR)`
    : media.skip;

describe.skipIf(skip !== '')(`subjects on the real models${skip ? ` (skipped: ${skip})` : ''}`, () => {
  it('finds the one pose, its face and head, inside the one person', { timeout: 60_000 }, async () => {
    const decoded = spawnSync(
      media.ctx!.binaries.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', FIXTURE, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { maxBuffer: SIZE.width * SIZE.height * 3 + 1024 },
    );
    expect(decoded.status).toBe(0);
    const rgb = new Uint8Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength);
    const detector = createOnnxSubjectDetector({ runtime: createOrtRuntime(), modelDir: DIR! });
    try {
      const result = await detector.detect({ rgb, ...SIZE });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const { faces, people, poses } = result.value;
      expect(poses).toHaveLength(1);
      expect(faces).toHaveLength(1);
      expect(people).toHaveLength(1);
      const face = faces[0]!.box;
      const person = people[0]!.box;
      // The face in the frame's upper half, head-sized.
      expect(face.y + face.height).toBeLessThan(0.5);
      expect(face.width).toBeGreaterThan(0.1);
      expect(face.width).toBeLessThan(0.5);
      // Its head holds the face.
      const { heads } = headsFrom(result.value, SIZE);
      expect(heads).toHaveLength(1);
      const head = heads[0]!.box;
      expect(head.x).toBeLessThanOrEqual(face.x);
      expect(head.y).toBeLessThanOrEqual(face.y);
      expect(head.x + head.width).toBeGreaterThanOrEqual(face.x + face.width);
      // The person reaches the frame's foot and holds the face.
      expect(person.y + person.height).toBeGreaterThan(0.95);
      expect(person.x).toBeLessThanOrEqual(face.x);
      expect(person.x + person.width).toBeGreaterThanOrEqual(face.x + face.width);
      expect(person.y).toBeLessThanOrEqual(face.y);
    } finally {
      await detector.release();
    }
  });
});

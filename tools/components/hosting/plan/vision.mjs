// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** ONNX Runtime and the vision models (manifest.vision.provisional.json). */
import { TEXTS } from '../texts.mjs';
import { hf, NOTARISED, REPACKED, UNCHANGED } from './common.mjs';

const GEMMA_REV = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
const gemma = (path, size, sha256) => ({
  path,
  pin: { url: hf('onnx-community/embeddinggemma-2-ONNX', GEMMA_REV, path), size, sha256 },
});
const PPOCR_DET = ['PaddlePaddle/PP-OCRv5_mobile_det_onnx', 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d'];
const PPOCR_REC = [
  'PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx',
  '251aec19e36739540d35e2cc943f6aa7503b98e5',
];
const PPOCR_LATIN_REC = [
  'PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx',
  '89d3a50e2c27e2e7cceeab0e944c25c807d5db4f',
];
/** PP-OCRv5's mobile text detector, the same one both recognisers pair with. */
const PPOCR_DET_FILES = [
  {
    path: 'det/inference.onnx',
    pin: {
      url: hf(...PPOCR_DET, 'inference.onnx'),
      size: 4826518,
      sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
    },
  },
  {
    path: 'det/inference.yml',
    pin: {
      url: hf(...PPOCR_DET, 'inference.yml'),
      size: 903,
      sha256: '98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699',
    },
  },
];
export const VISION = {
  onnxruntime: {
    file: 'onnxruntime-node-1.30.0-darwin-arm64.tar.zst',
    signature: 'taalcut',
    recipe: {
      kind: 'script',
      command: ['sh', 'tools/components/pack-onnxruntime.sh', '{stage}'],
      identity: true,
    },
    notice: {
      changes: [
        'The darwin-arm64 N-API binding and runtime library from the onnxruntime-node 1.30.0 npm package, signed by Taalcut with its Developer ID (hardened runtime, secure timestamp; tools/components/pack-onnxruntime.sh) and packed as tar.zst. Nothing else changed.',
        NOTARISED,
      ],
      extra: [
        "The runtime library compiles in Eigen, under the MPL-2.0, a file-level copyleft licence; everything else in it is under the permissive licences below (ThirdPartyNotices.txt). Eigen's exact source, the archive ONNX Runtime 1.30.0 builds with, is hosted beside this file.",
      ],
      texts: [TEXTS.onnxruntime, TEXTS.onnxruntimeThirdParty],
    },
    sources: [
      {
        file: 'source/eigen-1d8b82b0740839c0de7f1242a3585e3390ff5f33.zip',
        what: "Eigen (MPL-2.0) at commit 1d8b82b0, the archive ONNX Runtime 1.30.0's cmake/deps.txt pins (SHA-1 05b19b49e6fbb91246be711d801160528c135e34), unchanged.",
        pin: {
          url: 'https://github.com/eigen-mirror/eigen/archive/1d8b82b0740839c0de7f1242a3585e3390ff5f33/eigen-1d8b82b0740839c0de7f1242a3585e3390ff5f33.zip',
          size: 4075744,
          sha256: '6a60d76351f97132669daeeb721d6bf14b008101883ad2d687a3201c5c461eb0',
        },
      },
    ],
  },
  'embeddinggemma-2': {
    file: 'embeddinggemma-2-onnx-q4-vq4f16-daa72c5.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'stream',
      files: [
        gemma(
          'chat_template.jinja',
          1016,
          '4b852efc0b9960283e735363331e6f325b33bc74bdbaa076f595bc4e9b94d85e',
        ),
        gemma('config.json', 5031, '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d'),
        gemma(
          'config_sentence_transformers.json',
          1565,
          '031e56a498d33c349ab489a21885bcfe25b4fcba841149dc99e1e90d4a7c28f5',
        ),
        gemma(
          'onnx/model_q4.onnx',
          490742,
          'f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9',
        ),
        gemma(
          'onnx/model_q4.onnx_data',
          174028800,
          'c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49',
        ),
        gemma(
          'onnx/vision_encoder_q4f16.onnx',
          150693,
          '55975fba53928162eee37e9eea2a69965c10c0411ed14c24ea149efa55a8aa68',
        ),
        gemma(
          'onnx/vision_encoder_q4f16.onnx_data',
          97614336,
          '842f996aff092e300c966266ae0cc60771c6ca16282fee04ca83f0f159bc6b33',
        ),
        gemma(
          'preprocessor_config.json',
          560,
          '9344893f8d0573a46ebb2ca54c03f56d044cea194c8dcfb1f4d652240ac21daa',
        ),
        gemma(
          'processor_config.json',
          1788,
          '168f6a08522f3ce5dea596d94d003af2fd691742d4f41fe1f9d8cce76bfbf69c',
        ),
        gemma('tokenizer.json', 32170510, '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4'),
        gemma(
          'tokenizer_config.json',
          1599,
          '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874',
        ),
      ],
    },
    notice: {
      changes: REPACKED,
      extra: [
        'Google asks that deployments follow the Gemma Prohibited Use Policy: https://ai.google.dev/gemma/prohibited_use_policy',
      ],
      texts: [TEXTS.apache2],
    },
  },
  'embeddinggemma-2-coreml': {
    file: 'embeddinggemma-2-coreml-q4recipe-daa72c5.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'script',
      command: [
        'sh',
        'tools/components/pack-embeddinggemma-coreml.sh',
        '{unpacked:embeddinggemma-2}',
        '{stage}',
      ],
    },
    notice: {
      changes: [
        "FluidInference's Core ML graphs (Apache-2.0) with the embeddinggemma-2 component's weights written in, compiled for Core ML and packed without weights (a recipe rebuilds them from embeddinggemma-2 on first use) by tools/components/pack-embeddinggemma-coreml.sh.",
      ],
      extra: [
        'Google asks that deployments follow the Gemma Prohibited Use Policy: https://ai.google.dev/gemma/prohibited_use_policy',
      ],
      texts: [TEXTS.apache2],
    },
  },
  'ppocr-v5-devanagari': {
    file: 'ppocr-v5-devanagari-251aec19-e6f4fa85.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'stream',
      files: [
        {
          path: 'det/inference.onnx',
          pin: {
            url: hf(...PPOCR_DET, 'inference.onnx'),
            size: 4826518,
            sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
          },
        },
        {
          path: 'det/inference.yml',
          pin: {
            url: hf(...PPOCR_DET, 'inference.yml'),
            size: 903,
            sha256: '98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699',
          },
        },
        {
          path: 'rec/inference.onnx',
          pin: {
            url: hf(...PPOCR_REC, 'inference.onnx'),
            size: 7912311,
            sha256: 'cb789212ce96c69d3e74728ae4309d179281d68cb3945d0616b67cafab41c986',
          },
        },
        {
          path: 'rec/inference.yml',
          pin: {
            url: hf(...PPOCR_REC, 'inference.yml'),
            size: 5027,
            sha256: '9bd172dd26440c8ce94d1cde5d5baea6aefdc7cf3c5c8492e0beedef656d4e54',
          },
        },
      ],
      generated: [
        {
          path: 'charset.json',
          from: 'rec/inference.yml',
          by: 'paddle-charset',
          size: 3649,
          sha256: '621d0073b27b8d8ff19629ee7a961f337697f553a29f21c9817057f4359549c3',
        },
      ],
    },
    notice: {
      changes: [
        "Taalcut repacked the upstream ONNX files, unchanged, as one tar.zst, with charset.json: the recogniser's character list from rec/inference.yml as JSON.",
      ],
      texts: [TEXTS.paddleOcr],
    },
  },
  transnetv2: {
    file: 'transnetv2.onnx',
    signature: 'none',
    recipe: {
      kind: 'upstream',
      pin: {
        url: hf('elya5/transnetv2', 'e1cfcb717af91e41ffb84b5fd851505682c576ee', 'transnetv2.onnx'),
        size: 31250929,
        sha256: 'c4d54a682bace32f25136ef83ca2c9d403e8f8193775efeb995172a0d95a8e0c',
      },
    },
    notice: { changes: UNCHANGED, texts: [TEXTS.transnetv2] },
  },
  'transnetv2-coreml': {
    file: 'transnetv2-coreml-fp32-85cef72.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'script',
      command: [
        'sh',
        'tools/components/pack-transnetv2-coreml.sh',
        '{env:TAALCUT_IXV1_FOOTAGE}',
        '{artifact:transnetv2}',
        '{stage}',
      ],
    },
    notice: {
      changes: [
        "Upstream's weights in a Core ML rewrite of upstream's PyTorch port, converted (fp32) and compiled for Core ML by tools/components/pack-transnetv2-coreml.sh; upstream's LICENSE is inside the archive.",
      ],
      texts: [TEXTS.transnetv2],
    },
  },
};

/**
 * Latin text off Apple Silicon (vision's PADDLE_LATIN), packed like the Devanagari one: the Linux builds' (LNX1-CMP,
 * hosted since 2026-10-28).
 */
export const VISION_LINUX = {
  'ppocr-v5-latin': {
    file: 'ppocr-v5-latin-89d3a50e-e6f4fa85.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'stream',
      files: [
        ...PPOCR_DET_FILES,
        {
          path: 'rec/inference.onnx',
          pin: {
            url: hf(...PPOCR_LATIN_REC, 'inference.onnx'),
            size: 8042023,
            sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498',
          },
        },
        {
          path: 'rec/inference.yml',
          pin: {
            url: hf(...PPOCR_LATIN_REC, 'inference.yml'),
            size: 6817,
            sha256: '0bbe984570f597af3638e50bdf2e8276f3ab26a61966096538b3b0d1849f5c84',
          },
        },
      ],
      generated: [
        {
          path: 'charset.json',
          from: 'rec/inference.yml',
          by: 'paddle-charset',
          size: 5126,
          sha256: '5c397c267d7b8285ac13f4eee18d188573a607b403a1720c67d73882665be409',
        },
      ],
    },
    notice: {
      changes: [
        "Taalcut repacked the upstream ONNX files, unchanged, as one tar.zst, with charset.json: the recogniser's character list from rec/inference.yml as JSON.",
      ],
      texts: [TEXTS.paddleOcr],
    },
  },
};

/**
 * Not hosted yet (FRM1-SUB, compose-provisional.mjs's PENDING): poses, faces and people without the mac helper.
 * RTMO-s from MMPose's COCO checkpoint (Apache-2.0, COCO keypoints only), exported by the pack script, and
 * YOLOX-Nano from Megvii's 0.1.1rc0 release (Apache-2.0, COCO 2017), unchanged.
 */
export const VISION_PENDING = {
  'subjects-onnx': {
    file: 'subjects-onnx-rtmo-s-coco-yolox-nano.tar.zst',
    signature: 'none',
    recipe: { kind: 'script', command: ['sh', 'tools/components/pack-subjects-onnx.sh', '{stage}'] },
    notice: {
      changes: [
        "RTMO-s (MMPose's COCO checkpoint) exported to ONNX with mmdeploy 1.3.1 and its grouped convolutions rewritten as the same dense ones, by tools/components/pack-subjects-onnx.sh; YOLOX-Nano's ONNX unchanged. Both repacked into one archive.",
      ],
      texts: [TEXTS.mmpose, TEXTS.yolox],
    },
  },
};

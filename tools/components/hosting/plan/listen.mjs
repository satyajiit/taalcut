// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F3: the listening models (manifest.listen.provisional.json, hosted since 2026-11-07): CLAP's audio
 * and text encoders and the AudioSet tagger AST, from Xenova's ONNX exports pinned by commit, each as an int8 base
 * (the CPU build) and an fp16 variant (Metal, through ONNX Runtime's WebGPU provider). One flat tar.zst per build:
 * the graph renamed `model.onnx`, beside the upstream configs the runtime reads (tools/components/listen/README.md).
 * Nothing else changes in the bytes. Upstream weights: laion/larger_clap_general at 16c8cc31 (Apache-2.0) and
 * MIT/ast-finetuned-audioset-10-10-0.4593 at f826b80d (BSD-3-Clause); neither repository ships a licence file, so the
 * notices quote Apache's own text and the AST authors' BSD-3-Clause licence.
 */
import { TEXTS } from '../texts.mjs';
import { hf, REPACKED } from './common.mjs';

const CLAP = ['Xenova/larger_clap_general', 'd78c3994912c441f0151a5cc44d86f6b7bf4c861'];
const AST = ['Xenova/ast-finetuned-audioset-10-10-0.4593', '249a1fbf0286b40e7f1ed687a8ae396997bf7dc6'];

/** The licence texts only these components quote, pinned like texts.mjs's. */
export const LISTEN_TEXTS = {
  astBsd3: {
    title:
      'AST LICENSE (BSD-3-Clause, Copyright (c) 2021, Yuan Gong), YuanGongND/ast commit 31088be8: the licence MIT/ast-finetuned-audioset-10-10-0.4593 declares',
    url: 'https://raw.githubusercontent.com/YuanGongND/ast/31088be8a3f6ef96416145c4b8d43c81f99eba7a/LICENSE',
    sha256: '3b8967711439804577c6022cc9c9cc18c9e5312bf1ac3fc6e448784793df2bdc',
  },
  /** earshot's LICENSE at the pinned commit (third_party/earshot/LICENSE holds the same bytes). */
  earshotMit: {
    title:
      'earshot LICENSE (MIT, Copyright (c) 2026 Leon Lin), Leonxlnx/earshot commit ff41f078: the vocabulary the text embeddings describe',
    url: 'https://raw.githubusercontent.com/Leonxlnx/earshot/ff41f0788ae56896fd59879ab03858d223c06a53/LICENSE',
    sha256: 'd9177365c7471d18ecd623ce7b8849e26ab8d7e7fea13e1fcbda62397ecb9db8',
  },
  ccBy4: {
    title: 'Creative Commons Attribution 4.0 International (CC BY 4.0), legal code (creativecommons.org)',
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode.txt',
    sha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411',
  },
};

/** `from` in the Xenova repository `[repo, rev]`, at `path` in the archive. */
const file = ([repo, rev], from, size, sha256, path = from) => ({
  path,
  pin: { url: hf(repo, rev, from), size, sha256 },
});

const CLAP_CONFIG = file(
  CLAP,
  'config.json',
  587,
  'b8c3a259af1c9eee98570630d81881974a368364886678d9c6b04c6d15874837',
);
/**
 * EAR1-F5 (D23): the CLAP text embeddings of earshot's vocabulary and fixed phrases, one bank per text dtype, built by
 * ../../listen/build-text-embeddings.mjs and committed beside it. They ship in both audio builds so describing a sound
 * needs no text model; pack-listen-models.mjs puts the committed bytes in the cache, so nothing is downloaded. The
 * url hosts the same bytes since 2026-11-07, so a plain `build.mjs` can fetch them too.
 */
const TEXT_BANK_DIR = 'tools/components/listen/text-embeddings';
const textBank = (path, size, sha256) => ({
  path,
  repo: `${TEXT_BANK_DIR}/${path}`,
  pin: { url: `https://components.taalcut.app/listen-text/${sha256.slice(0, 12)}/${path}`, size, sha256 },
});
export const LISTEN_TEXT_BANK = [
  textBank(
    'listen-text-int8.json',
    19963,
    '1847351042cd2c5a1730f595f55c6f8969c8669806315a9204bd83c55305bac2',
  ),
  textBank(
    'listen-text-int8.f16',
    404480,
    '5465827048c48836df0524714a0337ab227d7a3b524387a5d9f000202cbe873c',
  ),
  textBank(
    'listen-text-fp16.json',
    19968,
    '93886a6e08d9e999ccba627318bec7840e4e1f0b7291b5a528c7eae10eb9e638',
  ),
  textBank(
    'listen-text-fp16.f16',
    404480,
    '618576b5dcb66a54dc3f2224c02e7ada2c9554fd8f73ac7b9b57283db28fe8a3',
  ),
];
const CLAP_AUDIO_FILES = [
  CLAP_CONFIG,
  file(
    CLAP,
    'preprocessor_config.json',
    541,
    '9739f58296aa6f9ac18008fd0150fb2649bc554985fbde86d0a4041c882ac753',
  ),
  ...LISTEN_TEXT_BANK,
];
const CLAP_TEXT_FILES = [
  CLAP_CONFIG,
  file(CLAP, 'merges.txt', 456318, '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5'),
  file(
    CLAP,
    'special_tokens_map.json',
    964,
    '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
  ),
  file(CLAP, 'tokenizer.json', 2108774, 'dc239041d98de27ffc3975473a1a23e3db4c937b23c138c38bbc66588bd247e5'),
  file(
    CLAP,
    'tokenizer_config.json',
    1392,
    '2c964a338683aec3695ea37687271e75b40905233f5d2a5bbb9be8cb40c4d0a0',
  ),
  file(CLAP, 'vocab.json', 798293, 'ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e'),
];
const AST_FILES = [
  file(AST, 'config.json', 26792, '49d0dce922da23685787c73a874d9b1ffa97297f8cc4dc0a4e8bef219725e44d'),
  file(
    AST,
    'preprocessor_config.json',
    297,
    '8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231',
  ),
];

const QUANTISED =
  'The int8 graph is 8-bit dynamic quantisation (QUInt8 weights, per channel) and the fp16 graph float16 weights, both made by Xenova with the transformers.js conversion script from the upstream weights.';
const renamed = (from) => [
  ...REPACKED,
  `The graph onnx/${from} is stored as model.onnx; the other files keep their names and bytes.`,
];

const CLAP_NOTICE = (graph) => ({
  changes: renamed(graph),
  extra: [
    `Upstream weights: laion/larger_clap_general at revision 16c8cc3159a3c8a31e8ff5ef1f66b0d9ab3667db (Apache-2.0). ONNX export: ${CLAP[0]} at revision ${CLAP[1]}. ${QUANTISED}`,
  ],
  texts: [TEXTS.apache2],
});
const CLAP_AUDIO_NOTICE = (graph) => ({
  changes: [
    ...renamed(graph),
    "Added by Taalcut: listen-text-int8 and listen-text-fp16 (.json index, .f16 float16 rows), the text embeddings of earshot 0.4.0's listening vocabulary and fixed phrases (earshot data, MIT, Leon Lin), computed with the int8 and fp16 builds of this CLAP text encoder.",
  ],
  extra: CLAP_NOTICE(graph).extra,
  texts: [TEXTS.apache2, LISTEN_TEXTS.earshotMit],
});
const AST_NOTICE = (graph) => ({
  changes: renamed(graph),
  extra: [
    `Upstream weights: MIT/ast-finetuned-audioset-10-10-0.4593 at revision f826b80d28226b62986cc218e5cec390b1096902 (BSD-3-Clause). ONNX export: ${AST[0]} at revision ${AST[1]}. ${QUANTISED}`,
    "The 527 class names in config.json (id2label, label2id) are AudioSet's (class_labels_indices.csv of the AudioSet dataset, Google Inc., CC BY 4.0, https://research.google.com/audioset/download.html), unchanged. The AudioSet ontology file itself (ontology.json, CC BY-SA 4.0) is not included.",
  ],
  texts: [LISTEN_TEXTS.astBsd3, LISTEN_TEXTS.ccBy4],
});

/** One build: `graph` (its name under onnx/ in `repo`, size, sha256) stored as model.onnx, beside `configs`. */
const build = (name, repo, [graph, size, sha256], configs, notice) => ({
  file: name,
  signature: 'none',
  recipe: {
    kind: 'pack',
    layout: 'file',
    files: [...configs, file(repo, `onnx/${graph}`, size, sha256, 'model.onnx')],
  },
  notice: notice(graph),
});

export const LISTEN = {
  'clap-general-audio': build(
    'clap-general-audio-int8-d78c3994.tar.zst',
    CLAP,
    [
      'audio_model_quantized.onnx',
      78155433,
      '320b831d0043d36aa8cfad0f36b64b7c597fa9ff01a5a9b505e37632923cf9ac',
    ],
    CLAP_AUDIO_FILES,
    CLAP_AUDIO_NOTICE,
  ),
  'clap-general-audio-fp16': build(
    'clap-general-audio-fp16-d78c3994.tar.zst',
    CLAP,
    ['audio_model_fp16.onnx', 143432227, '7331cfbef5e9b7eec56e489c93737556f5e22c8abf8978280f0ad38c4b2b1ed1'],
    CLAP_AUDIO_FILES,
    CLAP_AUDIO_NOTICE,
  ),
  'clap-general-text': build(
    'clap-general-text-int8-d78c3994.tar.zst',
    CLAP,
    [
      'text_model_quantized.onnx',
      126603263,
      '045614ce697750cf8876cb965ebfad3ef2d0ae7900dda897d7569f7be86521cd',
    ],
    CLAP_TEXT_FILES,
    CLAP_NOTICE,
  ),
  'clap-general-text-fp16': build(
    'clap-general-text-fp16-d78c3994.tar.zst',
    CLAP,
    ['text_model_fp16.onnx', 251029088, '9c06f2aa8b7da59c3a781c682cbca510206d198e2d0c9ebadb78927e38df7f94'],
    CLAP_TEXT_FILES,
    CLAP_NOTICE,
  ),
  'ast-audioset': build(
    'ast-audioset-int8-249a1fbf.tar.zst',
    AST,
    ['model_quantized.onnx', 90807386, '807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61'],
    AST_FILES,
    AST_NOTICE,
  ),
  'ast-audioset-fp16': build(
    'ast-audioset-fp16-249a1fbf.tar.zst',
    AST,
    ['model_fp16.onnx', 173686898, '5f41fdc5b94549d76ddab192ef5a0b859f9d873d6615705e6664b89ed0624f0c'],
    AST_FILES,
    AST_NOTICE,
  ),
};

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Licence texts the component notices quote, each pinned to an upstream revision and its sha256 (checked when it
 * is fetched into the cache, like every other source). Where a model repository ships no licence file, the
 * licence's own text from its steward stands in (Apache-2.0 from apache.org).
 */

const raw = (repo, rev, path) => `https://raw.githubusercontent.com/${repo}/${rev}/${path}`;

export const TEXTS = {
  apache2: {
    title: 'Apache License 2.0 (apache.org)',
    url: 'https://www.apache.org/licenses/LICENSE-2.0.txt',
    sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  },
  llamaCpp: {
    title: 'llama.cpp LICENSE (MIT), tag b11571',
    url: raw('ggml-org/llama.cpp', 'b11571', 'LICENSE'),
    sha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
  },
  llamaJson: {
    title: 'nlohmann/json (MIT), bundled in llama.cpp: licenses/LICENSE-jsonhpp, tag b11571',
    url: raw('ggml-org/llama.cpp', 'b11571', 'licenses/LICENSE-jsonhpp'),
    sha256: 'c0d068392ea65358b798b8c165103560f06e9e3b38c4ab4e2d8810a7b931af86',
  },
  llamaHttplib: {
    title: 'cpp-httplib (MIT), bundled in llama.cpp: vendor/cpp-httplib/LICENSE, tag b11571',
    url: raw('ggml-org/llama.cpp', 'b11571', 'vendor/cpp-httplib/LICENSE'),
    sha256: '4b45cbe16d7b71b89ae6127e26e0d90a029198ca5e958ad8e3d0b8bbed364d8b',
  },
  boringssl: {
    title:
      "BoringSSL LICENSE (Apache-2.0), tag 0.20260929.0, the version llama.cpp b11571's release build fetches",
    url: raw('google/boringssl', '0.20260929.0', 'LICENSE'),
    sha256: '827c8d8fc207c2392794eef9e00fe246f9f61fdcc132556c275be3dd8c3cd97f',
  },
  boringsslFiat: {
    title: 'fiat-crypto (Apache-2.0), bundled in BoringSSL: third_party/fiat/LICENSE, tag 0.20260929.0',
    url: raw('google/boringssl', '0.20260929.0', 'third_party/fiat/LICENSE'),
    sha256: '9eacbcb81be660840c714a560a9d65ba07913db98dd4baf969f78dd499fdd60f',
  },
  qwen4b: {
    title: 'Qwen3.5-4B LICENSE (Apache-2.0), Qwen/Qwen3.5-4B revision 851bf6e8',
    url: 'https://huggingface.co/Qwen/Qwen3.5-4B/raw/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/LICENSE',
    sha256: 'bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a',
  },
  qwen9b: {
    title: 'Qwen3.5-9B LICENSE (Apache-2.0), Qwen/Qwen3.5-9B revision c2022362',
    url: 'https://huggingface.co/Qwen/Qwen3.5-9B/raw/c202236235762e1c871ad0ccb60c8ee5ba337b9a/LICENSE',
    sha256: 'bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a',
  },
  qwen08b: {
    title: 'Qwen3.5-0.8B LICENSE (Apache-2.0), Qwen/Qwen3.5-0.8B revision 2fc06364',
    url: 'https://huggingface.co/Qwen/Qwen3.5-0.8B/raw/2fc06364715b967f1860aea9cf38778875588b17/LICENSE',
    sha256: 'bbedc3fda3305820b977265f01b8619d87570a6739de3a5582c3464840f1e57a',
  },
  onnxruntime: {
    title: 'ONNX Runtime LICENSE (MIT), tag v1.30.0',
    url: raw('microsoft/onnxruntime', 'v1.30.0', 'LICENSE'),
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  },
  onnxruntimeThirdParty: {
    title: 'ONNX Runtime ThirdPartyNotices.txt, tag v1.30.0',
    url: raw('microsoft/onnxruntime', 'v1.30.0', 'ThirdPartyNotices.txt'),
    sha256: '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
  },
  paddleOcr: {
    title: 'PaddleOCR LICENSE (Apache-2.0), commit dab3fe35',
    url: raw('PaddlePaddle/PaddleOCR', 'dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf', 'LICENSE'),
    sha256: '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e',
  },
  mmpose: {
    title: 'MMPose LICENSE (Apache-2.0, code and model zoo), tag v1.3.2',
    url: raw('open-mmlab/mmpose', '5408bc76f5b848cf925a0d1857899011d8c5b497', 'LICENSE'),
    sha256: 'aa2c6f3408169b96e5547c875deb481c91502514c1885fa0acb4b596c8909cb9',
  },
  yolox: {
    title: 'YOLOX LICENSE (Apache-2.0, code and weights), tag 0.1.1rc0',
    url: raw('Megvii-BaseDetection/YOLOX', 'e1052df71842031413f6030723c3607b839c80ce', 'LICENSE'),
    sha256: '577c03d505ec80f667ebf96ebd0cc4f6825c817ca1088ee348c48aaabd51bd92',
  },
  transnetv2: {
    title: 'TransNetV2 LICENSE (MIT), commit 85cef72a',
    url: raw('soCzech/TransNetV2', '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed', 'LICENSE'),
    sha256: 'a8d7a056688ccedebe89f18fd60f1a47128df94cb82669cd02459934919cbb6f',
  },
  whisperCpp: {
    title: 'whisper.cpp LICENSE (MIT), commit d1be6fde (also covers ggml)',
    url: raw('ggml-org/whisper.cpp', 'd1be6fde11ac6e0407606b4e42fe72d34add8037', 'LICENSE'),
    sha256: '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d',
  },
  openaiWhisper: {
    title: 'OpenAI Whisper LICENSE (MIT, code and weights), commit 86098128',
    url: raw('openai/whisper', '86098128c0b4f24f0e2aa2994de830614b474227', 'LICENSE'),
    sha256: 'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d',
  },
  beatThis: {
    title: 'Beat This! LICENSE (MIT, code and published weights), CPJKU/beat_this commit b95c8ab0',
    url: raw('CPJKU/beat_this', 'b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c', 'LICENSE'),
    sha256: '909ab6549794a18e9bb243aacfadda4a5f308436fc2846f350755c53c4f06ae1',
  },
  sileroVad: {
    title: 'Silero VAD LICENSE (MIT), tag v6.2.3',
    url: raw('snakers4/silero-vad', 'v6.2.3', 'LICENSE'),
    sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b',
  },
  allocStdlib: {
    title: 'alloc-stdlib LICENSE (BSD-3-Clause), dropbox/rust-alloc-no-stdlib commit 0a81fd69',
    url: raw('dropbox/rust-alloc-no-stdlib', '0a81fd6928ea3b33c8cd484aa4575d50ffb98012', 'LICENSE'),
    sha256: 'c0c56f26d9c051cac4d200c34c84e7ae9aaa853e01a982a1df08b09931e518ae',
  },
};

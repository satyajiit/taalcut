// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The embedded LLM runtime and its weights (manifest.local-llm.provisional.json). */
import { TEXTS } from '../texts.mjs';
import { hf, NOTARISED, SIGNED, UNCHANGED } from './common.mjs';

export const LOCAL_LLM = {
  'local-llm-runtime': {
    file: 'llama-b11571-bin-macos-arm64.tar.zst',
    signature: 'taalcut',
    recipe: {
      kind: 'resign-archive',
      source: 'tar.gz',
      layout: 'stream',
      stripComponents: 1,
      pin: {
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11571/llama-b11571-bin-macos-arm64.tar.gz',
        size: 12111943,
        sha256: 'd8b8000c6a534b258516686337fd2cb50b3b8060730a00029c8381048c76fbea',
      },
    },
    notice: {
      changes: [SIGNED, NOTARISED],
      extra: [
        "libllama-common and libllama-server-impl statically link BoringSSL 0.20260929.0 (Apache-2.0, with fiat-crypto's Apache-2.0 code), which llama.cpp's release build fetches from boringssl.googlesource.com for HTTPS; the llama binary's own licence list (llama.cpp, cpp-httplib, jsonhpp, BoringSSL) matches the texts below.",
        'The binaries also contain stb_image (MIT or public domain), miniaudio (public domain or MIT-0) and subprocess.h (Unlicense), vendored in llama.cpp with their licences in their headers.',
      ],
      texts: [TEXTS.llamaCpp, TEXTS.llamaJson, TEXTS.llamaHttplib, TEXTS.boringssl, TEXTS.boringsslFiat],
    },
  },
  'local-llm-qwen3-5-4b': {
    file: 'qwen3.5-4b-q4_k_m.gguf',
    signature: 'none',
    recipe: {
      kind: 'upstream',
      pin: {
        url: 'https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50',
        size: 2648593216,
        sha256: 'a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50',
      },
    },
    notice: { changes: UNCHANGED, texts: [TEXTS.qwen4b] },
  },
  'local-llm-qwen3-5-4b-mmproj': {
    file: 'qwen3.5-4b-mmproj-bf16.gguf',
    signature: 'none',
    recipe: {
      kind: 'upstream',
      pin: {
        url: 'https://registry.ollama.ai/v2/library/qwen3.5/blobs/sha256:e56a899b1540860385465756dd308c84417410b94dbc1c380adffd20a921ca60',
        size: 675569120,
        sha256: 'e56a899b1540860385465756dd308c84417410b94dbc1c380adffd20a921ca60',
      },
    },
    notice: { changes: UNCHANGED, texts: [TEXTS.qwen4b] },
  },
  'local-llm-qwen3-5-0-8b': {
    file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    signature: 'none',
    recipe: {
      kind: 'upstream',
      pin: {
        url: hf(
          'unsloth/Qwen3.5-0.8B-GGUF',
          '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
          'Qwen3.5-0.8B-Q4_K_M.gguf',
        ),
        size: 532517120,
        sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
      },
    },
    notice: { changes: UNCHANGED, texts: [TEXTS.qwen08b] },
  },
};

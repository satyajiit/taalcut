// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * linux-x64 (LNX1-CMP): the components only Linux has (the CUDA runtime and the accelerator builds), and the
 * linux-x64 artifact of components other platforms have too (LINUX_X64, merged into their plans as
 * `platforms['linux-x64']`, artifacts.mjs). Built on a Linux host: `build.mjs --platform linux-x64`. Nothing here
 * holds a Mach-O file, so every signature is 'none'; the ELF checks are the pack scripts' (glibc 2.35 at most for
 * what Taalcut builds, no search path outside the component).
 */
import { TEXTS } from '../texts.mjs';
import { UNCHANGED } from './common.mjs';

const script = (...args) => ({ kind: 'script', command: ['sh', ...args, '{stage}'] });
const LLAMA = 'https://github.com/ggml-org/llama.cpp/releases/download/b11571';
const llama = (file, size, sha256) => ({
  kind: 'upstream',
  format: 'tar.gz',
  stripComponents: 1,
  pin: { url: `${LLAMA}/${file}`, size, sha256 },
});
const LLAMA_TEXTS = [TEXTS.llamaCpp, TEXTS.llamaJson, TEXTS.llamaHttplib];
const LLAMA_LINKS =
  "The linux-x64 builds link the system's OpenSSL 3 (libssl3), OpenMP runtime (libgomp1) and C++ runtime dynamically, and hold stb_image (MIT or public domain), miniaudio (public domain or MIT-0) and subprocess.h (Unlicense), vendored in llama.cpp with their licences in their headers.";
/**
 * NVIDIA's terms, which the person accepts in the app before the CUDA runtime downloads (LNX1-TRM): the component's
 * `licence.acceptance`. manifest.linux.provisional.json carries the same object, and packages/jobs' linux-manifest test holds the
 * two equal. A new termsVersion asks everyone again.
 */
export const NVIDIA_ACCEPTANCE = {
  owner: 'NVIDIA Corporation',
  termsVersion: '2026-10-27',
  documents: [
    { title: 'CUDA Toolkit End User License Agreement', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
    {
      title: 'NVIDIA cuDNN Software License Agreement',
      url: 'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
    },
  ],
};
const [CUDA_EULA, CUDNN_SLA] = NVIDIA_ACCEPTANCE.documents;
const NVIDIA_TERMS = [
  `These files are made and owned by NVIDIA Corporation, and NVIDIA licenses them to you under its own terms, quoted below from the archive: the ${CUDA_EULA.title} (${CUDA_EULA.url}; its Attachment A lists cudart, cuBLAS, cuBLASLt, cuRAND and NVRTC as redistributable) and the ${CUDNN_SLA.title} (${CUDNN_SLA.url}). Taalcut doesn't own, change or sell them. It hosts NVIDIA's files unchanged and downloads them to your computer only after you accept NVIDIA's terms in the app, so that its CUDA builds can use your NVIDIA GPU. They need NVIDIA's driver 580 or later, which is not included.`,
];
const WHISPER_BUILT =
  'Built by Taalcut from whisper.cpp v1.9.5 (d1be6fde) with tools/whisper/build-linux.sh in a pinned Ubuntu 22.04 container (nvidia/cuda:13.4.3-devel-ubuntu22.04 by digest; GGML_NATIVE off, so AVX2 x86-64; libgcc and libstdc++ static).';

/** Components only Linux has. */
export const LINUX = {
  'cuda-runtime-13': {
    file: 'cuda-runtime-13.4.3-cudnn9.27.0-linux-x64.tar.zst',
    // Stated in the manifest (licence.acceptance); here so the notice and the manifest name the same documents.
    acceptance: NVIDIA_ACCEPTANCE,
    signature: 'none',
    recipe: script('tools/components/linux/pack-cuda-runtime.sh'),
    notice: {
      changes: [
        "NVIDIA's redistributable CUDA 13.4.3 libraries (cudart 13.4.92, cuBLAS and cuBLASLt 13.8.0.4, cuRAND 10.4.4.72, NVRTC 13.4.92) and cuDNN 9.27.0.42 for CUDA 13, the shared libraries only, unchanged, from NVIDIA's redist archives (each checked against the sha256 in NVIDIA's redistrib JSON), packed as tar.zst by tools/components/linux/pack-cuda-runtime.sh.",
      ],
      extra: NVIDIA_TERMS,
      inArtifactDir: 'LICENSES',
    },
  },
  'onnxruntime-cuda': {
    file: 'onnxruntime-node-1.30.0-cuda13-linux-x64.tar.zst',
    signature: 'none',
    recipe: script('tools/components/linux/pack-onnxruntime.sh', 'cuda'),
    notice: {
      changes: [
        "onnxruntime-node 1.30.0's linux-x64 N-API binding and libonnxruntime.so.1 from its npm package, with libonnxruntime_providers_shared.so and libonnxruntime_providers_cuda.so from NuGet's Microsoft.ML.OnnxRuntime.Gpu.Linux 1.30.0 (the package onnxruntime-node's install script fetches), all unchanged, packed as tar.zst by tools/components/linux/pack-onnxruntime.sh. The CUDA provider loads the cuda-runtime-13 component's libraries.",
      ],
      extra: [
        "The runtime library compiles in Eigen, under the MPL-2.0, a file-level copyleft licence; everything else in it is under the permissive licences below (ThirdPartyNotices.txt). Eigen's exact source, the archive ONNX Runtime 1.30.0 builds with, is hosted beside the onnxruntime component.",
      ],
      texts: [TEXTS.onnxruntime, TEXTS.onnxruntimeThirdParty],
    },
  },
  'local-llm-runtime-cuda': {
    file: 'llama-b11571-bin-ubuntu-cuda-13.4-x64.tar.gz',
    signature: 'none',
    recipe: llama(
      'llama-b11571-bin-ubuntu-cuda-13.4-x64.tar.gz',
      152485973,
      '42f31a6b1fba358c68b66de956216291571ec3bc3db6f5e8972a797751ee6c28',
    ),
    notice: {
      changes: [
        ...UNCHANGED,
        "llama.cpp's own ubuntu-cuda-13.4-x64 release build. It loads CUDA's libraries from the cuda-runtime-13 component, not from upstream's cudart archive.",
      ],
      extra: [LLAMA_LINKS],
      texts: LLAMA_TEXTS,
    },
  },
  'local-llm-runtime-vulkan': {
    file: 'llama-b11571-bin-ubuntu-vulkan-x64.tar.gz',
    signature: 'none',
    recipe: llama(
      'llama-b11571-bin-ubuntu-vulkan-x64.tar.gz',
      30287313,
      '39dc4772a26b0c8e45a80aa5e2a508886f98bdb5856758a28bf1c5d7a9c31303',
    ),
    notice: {
      changes: [
        ...UNCHANGED,
        "llama.cpp's own ubuntu-vulkan-x64 release build; it uses the system's Vulkan loader.",
      ],
      extra: [LLAMA_LINKS],
      texts: LLAMA_TEXTS,
    },
  },
  'whisper-server-cuda': {
    file: 'whisper-server-1.9.5-cuda13-linux-x64.tar.zst',
    signature: 'none',
    recipe: script('tools/components/linux/pack-whisper.sh', 'cuda', 'whisper-server'),
    notice: {
      changes: [
        `${WHISPER_BUILT} With CUDA (GGML_CUDA) for compute capability 7.5, 8.0, 8.6, 8.9, 9.0 and 12.0, and PTX for 12.0; cudart and cuBLAS are linked shared, from the cuda-runtime-13 component.`,
      ],
      extra: [
        'The binary also contains miniaudio (public domain or MIT No Attribution) and stb_vorbis (MIT or public domain), vendored in whisper.cpp with their licences in their sources, and cpp-httplib (MIT) and nlohmann/json (MIT); their licences follow.',
      ],
      texts: [TEXTS.whisperCpp, TEXTS.llamaHttplib, TEXTS.llamaJson],
    },
  },
};

/** The linux-x64 artifact of components other platforms have: `platforms['linux-x64']` of their plans. */
export const LINUX_X64 = {
  onnxruntime: {
    file: 'onnxruntime-node-1.30.0-linux-x64.tar.zst',
    signature: 'none',
    recipe: script('tools/components/linux/pack-onnxruntime.sh', 'cpu'),
    notice: {
      changes: [
        "linux-x64: onnxruntime-node 1.30.0's N-API binding and libonnxruntime.so.1 (CPU and WebGPU) from its npm package, unchanged, packed as tar.zst by tools/components/linux/pack-onnxruntime.sh.",
      ],
    },
  },
  'local-llm-runtime': {
    file: 'llama-b11571-bin-ubuntu-x64.tar.gz',
    signature: 'none',
    recipe: llama(
      'llama-b11571-bin-ubuntu-x64.tar.gz',
      17725590,
      'f955f2eb69357c2b0a2ed3f796652a24763d7e068be3ab30fcc4e12c92d0f4be',
    ),
    notice: {
      changes: ["linux-x64: llama.cpp's own ubuntu-x64 (CPU) release build, hosted unchanged."],
      extra: [LLAMA_LINKS],
    },
  },
  'whisper-cpp': {
    file: 'whisper-cli-linux-x64',
    signature: 'none',
    recipe: script('tools/components/linux/pack-whisper.sh', 'cpu', 'whisper-cli'),
    notice: { changes: [`linux-x64: ${WHISPER_BUILT} CPU only.`] },
  },
  'hyperframes-headless-shell': {
    file: 'chrome-headless-shell-157.0.8103.50-linux64.tar.zst',
    signature: 'none',
    recipe: script('tools/components/linux/pack-headless-shell.sh'),
    notice: {
      changes: [
        "linux-x64: Chrome for Testing's chrome-headless-shell 157.0.8103.50 (linux64 zip, sha256 7bf0d41e…7d0f), unchanged, repacked as tar.zst by tools/components/linux/pack-headless-shell.sh. It links the system's NSS, NSPR, GLib, D-Bus, expat, GBM, ALSA, X11 and xkbcommon libraries dynamically.",
      ],
      inArtifact: [
        {
          title: 'LICENSE.headless_shell (Chromium and its third-party licences, from the archive)',
          path: 'chrome-headless-shell-linux64/LICENSE.headless_shell',
        },
      ],
    },
  },
  'c2pa-sidecar': {
    file: 'c2pa-sidecar-1.0.0-linux-x64.tar.zst',
    signature: 'none',
    recipe: { kind: 'c2pa', layout: 'stream', target: 'x86_64-unknown-linux-gnu' },
    notice: {
      changes: [
        'linux-x64: built by Taalcut from the same source with Rust 1.97.1 in a pinned Ubuntu 22.04 container (tools/components/linux/build-c2pa.sh; cargo build --release --locked --offline, every crate vendored by the lock file), packed as tar.zst with LICENSES/ like the macOS one.',
      ],
      inArtifactDir: 'LICENSES',
    },
  },
  'whisper-server': {
    file: 'whisper-server-linux-x64',
    signature: 'none',
    recipe: script('tools/components/linux/pack-whisper.sh', 'cpu', 'whisper-server'),
    notice: { changes: [`linux-x64: ${WHISPER_BUILT} CPU only.`] },
  },
};

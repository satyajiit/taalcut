// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MLX1: Taalcut's MLX server and Qwen3.5 9B on MLX, for Apple silicon Macs of the High tier
 * (manifest.local-llm-mlx.provisional.json), hosted since 2026-11-11 and included in the production manifest.
 */
import { TEXTS } from '../texts.mjs';
import { hf, NOTARISED, REPACKED } from './common.mjs';

/** mlx-community's MLX 4-bit conversion of Qwen/Qwen3.5-9B (Apache-2.0), at a pinned revision. */
const QWEN9B_MLX = ['mlx-community/Qwen3.5-9B-4bit', '8b2b98c00a6b4d291155e4890773ca8f769aee53'];
const mlxFile = (path, size, sha256) => ({ path, pin: { url: hf(...QWEN9B_MLX, path), size, sha256 } });

export const LOCAL_LLM_MLX = {
  'local-llm-runtime-mlx': {
    file: 'taalcut-mlx-server-1.0.0-darwin-arm64.tar.zst',
    signature: 'taalcut',
    // build.sh signs the executable and the Span back-deployment library with TAALCUT_MAC_IDENTITY.
    recipe: { kind: 'script', command: ['bash', 'native/mlx-server/build.sh', '--tarball'], identity: true },
    sources: [
      {
        file: 'source/taalcut-mlx-server-1.0.0-source.tar.zst',
        what: "taalcut-mlx-server's source (AGPL-3.0-or-later): native/mlx-server as it is in Taalcut's repository, with Package.resolved (every Swift package it links, by revision) and build.sh.",
        repo: { paths: ['native/mlx-server', 'LICENSE'] },
      },
      {
        file: 'source/taalcut-mlx-server-1.0.0-dependencies-source.tar.zst',
        what: 'Exact Swift dependency sources, recursively pinned submodules and upstream licence texts, exported from the clean build checkouts verified against Package.resolved. SOURCE-INVENTORY.json records every revision.',
        pin: {
          url: 'https://components.taalcut.app/local-llm-runtime-mlx/1.0.0/source/taalcut-mlx-server-1.0.0-dependencies-source.tar.zst',
          size: 24201462,
          sha256: '0ad05877c2d2d59ed08eec12142f11dd99b9f6e7d1ef12bdaaf3507e05caa099',
        },
      },
    ],
    notice: {
      changes: [
        "Built by Taalcut from native/mlx-server with xcodebuild (Xcode 26, macOS 14 target, arm64), signed with its Developer ID (hardened runtime, secure timestamp) and packed as tar.zst with mlx.metallib (MLX's Metal kernels), Apple's Swift Span back-deployment library (libswiftCompatibilitySpan.dylib, loaded on macOS 14 and 15 only), BUILDINFO.json and LICENSES/: the licence of every package linked in (the Swift packages, and the XGrammar C++ that mlx-swift-lm vendors, with its picojson and dlpack).",
        NOTARISED,
      ],
      extra: [
        "taalcut-mlx-server itself is Taalcut's, under the AGPL-3.0-or-later; its source is hosted beside this file. It statically links mlx-swift 0.32.3 and mlx-swift-lm 3.32.3 (MIT, ml-explore) with MLX, mlx-c, fmt and nlohmann/json (MIT) and metal-cpp (Apache-2.0); swift-transformers 1.3.5, swift-jinja 2.5.2, swift-huggingface 1.0.0, swift-collections 1.7.5, swift-crypto 4.5.2, swift-asn1 1.7.3 and swift-numerics 1.1.1 (Apache-2.0); EventSource 1.5.1 and yyjson 0.12.0 (MIT).",
      ],
      inArtifactDir: 'LICENSES',
    },
  },
  'local-llm-qwen3-5-9b-mlx': {
    file: 'qwen3.5-9b-mlx-4bit.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'stream',
      // Quantised weights gain little from level19, which makes releases needlessly slow. Pin level3 explicitly.
      compressionLevel: 3,
      files: [
        mlxFile(
          'chat_template.jinja',
          7756,
          'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715',
        ),
        mlxFile('config.json', 3331, 'a96942cb6a8a1d3f1d17514d81a1925d04362a6a3233b389d13012211baaa9f8'),
        mlxFile(
          'model-00001-of-00002.safetensors',
          5349771222,
          'a68b87558c6ef43f74c2bd63ce7e9092ceddc3101f3def0030774bae5f42aadd',
        ),
        mlxFile(
          'model-00002-of-00002.safetensors',
          600449850,
          'b0a770bf8469c7f3f18756a0e0283f1c1174344a83e059a4e483f6af4907352d',
        ),
        mlxFile(
          'model.safetensors.index.json',
          123592,
          'dd023913fb87cfdae27fb11dcf695117c925833796ccac3c64117d6652d8ff1e',
        ),
        mlxFile(
          'preprocessor_config.json',
          390,
          '27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516',
        ),
        mlxFile(
          'processor_config.json',
          1300,
          '14932921ca485d458a04dafd8069fbb0a4505622a48208d19ed247115801385b',
        ),
        mlxFile(
          'tokenizer.json',
          19989343,
          '87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4',
        ),
        mlxFile(
          'tokenizer_config.json',
          1139,
          'e98f1901ac6f0adff67b1d540bfa0c36ac1a0cf59eb72ed78146ef89aafa1182',
        ),
        mlxFile(
          'video_preprocessor_config.json',
          385,
          '7768af27c1fafa9cc9011c1dc20067e03f8915e03b63504550e11d5066986d13',
        ),
      ],
    },
    notice: {
      changes: REPACKED,
      extra: [
        "Qwen3.5-9B by the Qwen team, Alibaba Cloud (Apache-2.0), converted to MLX and quantised to 4 bits (group size 64) by mlx-community with mlx-vlm 0.3.12: mlx-community/Qwen3.5-9B-4bit at revision 8b2b98c00a6b4d291155e4890773ca8f769aee53. The ten files Taalcut's MLX server reads, with the vision tower in the weights.",
      ],
      texts: [TEXTS.qwen9b],
    },
  },
};

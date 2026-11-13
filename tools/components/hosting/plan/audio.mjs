// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** whisper.cpp, its models and Beat This! (manifest.audio.provisional.json). */
import { TEXTS } from '../texts.mjs';
import { hf, NOTARISED, REPACKED, UNCHANGED } from './common.mjs';

const VENDORED_AUDIO =
  'The binary also contains miniaudio (public domain or MIT No Attribution) and stb_vorbis (MIT or public domain), vendored in whisper.cpp with their licences in their sources.';

const BEAT_REV = '25308706dda545c0d5950065bb0604ad71bcf1f5';
const WHISPER_MODELS = ['ggerganov/whisper.cpp', '5359861c739e955e79d9a303bcbc70fb988958b1'];

const whisperModel = (file, size, sha256) => ({
  file,
  signature: 'none',
  recipe: { kind: 'upstream', pin: { url: hf(...WHISPER_MODELS, file), size, sha256 } },
  notice: { changes: UNCHANGED, texts: [TEXTS.openaiWhisper, TEXTS.whisperCpp] },
});

export const AUDIO = {
  'whisper-cpp': {
    file: 'whisper-cli',
    signature: 'taalcut',
    recipe: { kind: 'whisper', binary: 'whisper-cli' },
    notice: {
      changes: [
        'Built by Taalcut from whisper.cpp v1.9.5 (d1be6fde) with tools/whisper/build.sh (static, Metal library embedded) and signed with its Developer ID (hardened runtime, secure timestamp).',
        NOTARISED,
      ],
      extra: [VENDORED_AUDIO],
      texts: [TEXTS.whisperCpp],
    },
  },
  'whisper-server': {
    file: 'whisper-server',
    signature: 'taalcut',
    recipe: { kind: 'whisper', binary: 'whisper-server' },
    notice: {
      changes: [
        'Built by Taalcut from whisper.cpp v1.9.5 (d1be6fde) with tools/whisper/build.sh (static, Metal library embedded) and signed with its Developer ID (hardened runtime, secure timestamp).',
        NOTARISED,
      ],
      extra: [
        VENDORED_AUDIO,
        'It also contains cpp-httplib (MIT) and nlohmann/json (MIT), vendored in whisper.cpp; their licences follow.',
      ],
      texts: [TEXTS.whisperCpp, TEXTS.llamaHttplib, TEXTS.llamaJson],
    },
  },
  'beat-this': {
    file: 'beat-this-1.1.0-onnx-25308706.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'pack',
      layout: 'file',
      files: [
        {
          path: 'beat_this.onnx',
          pin: {
            url: hf('musetric/beat-this-onnx', BEAT_REV, 'beat_this.onnx'),
            size: 190649026,
            sha256: '1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55',
          },
        },
        {
          path: 'config.json',
          pin: {
            url: hf('musetric/beat-this-onnx', BEAT_REV, 'config.json'),
            size: 1012,
            sha256: '966f271e9a44c8f1b9e438622b34165ecdf6df9adedc8a9c0a6f7fd9d3458cc2',
          },
        },
        {
          path: 'mel-filterbank.bin',
          pin: {
            url: hf('musetric/beat-this-onnx', BEAT_REV, 'mel-filterbank.bin'),
            size: 262656,
            sha256: '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533',
          },
        },
      ],
    },
    notice: { changes: REPACKED, texts: [TEXTS.beatThis] },
  },
  'whisper-tiny': whisperModel(
    'ggml-tiny.bin',
    77691713,
    'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  ),
  'whisper-small-q8-0': whisperModel(
    'ggml-small-q8_0.bin',
    264464607,
    '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
  ),
  'whisper-medium-q5-0': whisperModel(
    'ggml-medium-q5_0.bin',
    539212467,
    '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
  ),
};

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-device models and runtimes the indexing e2e needs, installed into
 * the test's userData the way the app installs them (packages/jobs's
 * component manager: sha256-checked download, staging, rename into
 * installed/), but from local files, so the app itself runs with no network.
 *
 * The files come from a cache folder, TAALCUT_COMPONENT_CACHE (default
 * Taalcut-dev/components in the OS's cache folder, dev-cache.ts): the archives
 * the vision and audio lanes packed (tools/components, provisional manifests),
 * the whisper.cpp models, tools/whisper's whisper-cli and whisper-server, and
 * Silero VAD. The native ones are this machine's build, named as the packing
 * scripts name them (hosting/plan), and seeded as its platform key's artifact
 * (`currentPlatform()`, as the app selects them); the models are `any`
 * (LNX1-PKG). Each entry's sha256 and size are measured from the cached file,
 * so the manager checks the bytes it installs; a missing file is listed by
 * `missingComponents`, and the test fails saying which (it never skips
 * silently).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { release } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { createComponentManager, currentPlatform, type ComponentManifest } from '@taalcut/jobs';
import { precompileCoreMl } from './coreml-precompile';
import { devCache } from './dev-cache';

export const COMPONENT_CACHE = process.env.TAALCUT_COMPONENT_CACHE?.trim() || devCache('components');

/** This machine's platform key: the artifact its native components are seeded as. */
const PLATFORM = currentPlatform();

/** The cached files of this platform's native builds, as hosting/plan names them; none for an unbuilt platform. */
const NATIVE_FILES: Readonly<
  Record<string, { onnxruntime: string; whisperCli: string; whisperServer: string }>
> = {
  'darwin-arm64': {
    onnxruntime: 'onnxruntime-node-1.30.0-darwin-arm64.tar.zst',
    whisperCli: 'whisper-cli',
    whisperServer: 'whisper-server',
  },
  'linux-x64': {
    onnxruntime: 'onnxruntime-node-1.30.0-linux-x64.tar.zst',
    whisperCli: 'whisper-cli-linux-x64',
    whisperServer: 'whisper-server-linux-x64',
  },
};
const unbuilt = (what: string) => `<no ${PLATFORM} build of ${what}>`;
const native = NATIVE_FILES[PLATFORM] ?? {
  onnxruntime: unbuilt('onnxruntime'),
  whisperCli: unbuilt('whisper-cli'),
  whisperServer: unbuilt('whisper-server'),
};

interface LocalComponent {
  readonly id: string;
  /** The file's name in the cache. */
  readonly file: string;
  readonly kind: 'runtime' | 'model' | 'tool';
  /** `PLATFORM` for a native build, `any` for the rest. */
  readonly platform: string;
  readonly install:
    | { readonly type: 'file'; readonly fileName: string; readonly executable: boolean }
    | { readonly type: 'archive'; readonly format: 'tar.zst' };
}

const archive = (
  id: string,
  file: string,
  kind: LocalComponent['kind'],
  platform = 'any',
): LocalComponent => ({
  id,
  file,
  kind,
  platform,
  install: { type: 'archive', format: 'tar.zst' },
});

/** A model file, installed under its own name. */
const plain = (id: string, file: string): LocalComponent => ({
  id,
  file,
  kind: 'model',
  platform: 'any',
  install: { type: 'file', fileName: file, executable: false },
});

/** This platform's build of a tool, installed under the name the app runs it by. */
const tool = (id: string, file: string, fileName: string): LocalComponent => ({
  id,
  file,
  kind: 'tool',
  platform: PLATFORM,
  install: { type: 'file', fileName, executable: true },
});

/** Darwin 24 is macOS 15: the first whose Core ML loads the embedder's multifunction models. */
const MACOS_15 = process.platform === 'darwin' && Number.parseInt(release(), 10) >= 24;
const MAC = process.platform === 'darwin';

/**
 * What indexing uses: embeddings (on macOS 15 and later also their Core ML build, which the app embeds with there),
 * Devanagari OCR, ORT, language id and transcripts (whisper-server, one per model, once the audio lane's IX work is
 * in; whisper-cli before), voice activity (Silero), beats, shot boundaries (TransNetV2, IX2-C4; on a Mac also its
 * Core ML build, which the app runs first there, IX2-S10; without either shots fall back to scdet and the embedding
 * check).
 */
export const INDEXING_COMPONENTS: readonly LocalComponent[] = [
  archive('onnxruntime', native.onnxruntime, 'runtime', PLATFORM),
  archive('embeddinggemma-2', 'embeddinggemma-2-onnx-q4-vq4f16-daa72c5.tar.zst', 'model'),
  ...(MACOS_15
    ? [
        archive(
          'embeddinggemma-2-coreml',
          'embeddinggemma-2-coreml-q4recipe-daa72c5.tar.zst',
          'model',
          PLATFORM,
        ),
      ]
    : []),
  archive('ppocr-v5-devanagari', 'ppocr-v5-devanagari-251aec19-e6f4fa85.tar.zst', 'model'),
  archive('beat-this', 'beat-this.tar.zst', 'model'),
  tool('whisper-cpp', native.whisperCli, 'whisper-cli'),
  tool('whisper-server', native.whisperServer, 'whisper-server'),
  plain('silero-vad', 'silero_vad.onnx'),
  plain('whisper-tiny', 'ggml-tiny.bin'),
  plain('whisper-small-q8-0', 'ggml-small-q8_0.bin'),
  plain('whisper-medium-q5-0', 'ggml-medium-q5_0.bin'),
  plain('transnetv2', 'transnetv2.onnx'),
  ...(MAC ? [archive('transnetv2-coreml', 'transnetv2-coreml-fp32-85cef72.tar.zst', 'model', PLATFORM)] : []),
];

/** Cached files the seed needs and can't find. */
export function missingComponents(cache = COMPONENT_CACHE): string[] {
  return INDEXING_COMPONENTS.filter((c) => !existsSync(join(cache, c.file))).map(
    (c) => `${c.id} (${c.file})`,
  );
}

const URL_BASE = 'https://components.e2e.invalid/';
/** Each seeded component's licence notice, served beside its file: the install saves and records one (round 3). */
const NOTICE_SUFFIX = '.NOTICE.txt';
const SEEDED_NOTICE = Buffer.from(
  'Seeded for an e2e run. Its published notice is on components.taalcut.app.\n',
);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifestOf(cache: string): ComponentManifest {
  return {
    schemaVersion: 1,
    components: INDEXING_COMPONENTS.map((c) => {
      const path = join(cache, c.file);
      const size = statSync(path).size;
      const sha = sha256(path);
      return {
        id: c.id,
        name: c.id,
        version: `e2e-${sha.slice(0, 12)}`,
        kind: c.kind,
        tiers: [],
        licence: {
          spdx: 'MIT',
          notice: {
            url: `${URL_BASE}${c.file}${NOTICE_SUFFIX}`,
            size: SEEDED_NOTICE.length,
            sha256: createHash('sha256').update(SEEDED_NOTICE).digest('hex'),
          },
        },
        dependencies: [],
        artifacts: [
          {
            platform: c.platform,
            urls: [`${URL_BASE}${c.file}`],
            sha256: sha,
            size,
            install:
              c.install.type === 'file'
                ? c.install
                : // An upper bound: the cap extraction stops at, and the disk check's need. At least 64 MB: the Core ML
                  // embedder's recipe archive (1.9 MB) extracts to 16 MB, its model.mil texts compress about 15×.
                  { ...c.install, stripComponents: 0, extractedSize: Math.max(size * 8, 64 * 2 ** 20) },
          },
        ],
      };
    }),
  } as ComponentManifest;
}

/** Serves the cached files at their e2e URLs; anything else is a 404 (nothing goes out). */
function localFetch(cache: string): typeof globalThis.fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(URL_BASE)) return new Response(null, { status: 404 });
    if (url.endsWith(NOTICE_SUFFIX)) {
      const notice = new Response(SEEDED_NOTICE, {
        status: 200,
        headers: { 'content-length': String(SEEDED_NOTICE.length) },
      });
      Object.defineProperty(notice, 'url', { value: url });
      return notice;
    }
    const path = join(cache, basename(new URL(url).pathname));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    const response = new Response(body, {
      status: 200,
      headers: { 'content-length': String(statSync(path).size) },
    });
    // The downloader checks which URL answered (a fetched Response says; a constructed one doesn't).
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
}

/**
 * Installs every indexing component into `<userData>/components`, and with `compileCoreMl` (the bench) compiles the
 * Core ML embedder there too (coreml-precompile.ts). Returns how long it took.
 */
export async function seedComponents(
  userData: string,
  cache = COMPONENT_CACHE,
  options: { readonly compileCoreMl?: boolean } = {},
): Promise<number> {
  const started = Date.now();
  const manager = createComponentManager({
    root: join(userData, 'components'),
    manifest: manifestOf(cache),
    fetch: localFetch(cache),
  });
  const paths = new Map<string, string>();
  for (const component of INDEXING_COMPONENTS) {
    const installed = await manager.install(component.id);
    if (!installed.ok)
      throw new Error(
        `${component.id} not installed: ${installed.error.code} ${installed.error.detail ?? ''}`,
      );
    paths.set(component.id, installed.value.path);
  }
  const coreml = paths.get('embeddinggemma-2-coreml');
  const onnx = paths.get('embeddinggemma-2');
  if (options.compileCoreMl && coreml && onnx) {
    const compiledMs = await precompileCoreMl(coreml, onnx, userData);
    console.warn(`[seed] Core ML embedder compiled for this Mac in ${compiledMs} ms`);
  }
  return Date.now() - started;
}

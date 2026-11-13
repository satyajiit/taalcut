// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg build each platform ships, as data: what `-version` reports, where the binaries and libraries sit
 * in the build folder, whether a Vulkan driver comes with it, and the hashes this release pins. The resolver,
 * `pinBuild` and packaging read one row; nothing else branches on the platform.
 *
 * - darwin-arm64: tools/ffmpeg/build.sh, static, with MoltenVK as the Vulkan driver (`lib/MoltenVK_icd.json`).
 * - linux-x64: tools/ffmpeg/build-linux.sh, LGPL-2.1-or-later like the Mac's: FFmpeg's seven shared libraries in
 *   `lib/` (the third-party code static inside them) and `bin/ffmpeg`, `bin/ffprobe` (RPATH `$ORIGIN/../lib`). No
 *   Vulkan driver ships: libplacebo uses the system loader (libvulkan1) and the GPU's own ICD, and picks the discrete
 *   GPU first (the NVIDIA card over an Intel iGPU, measured on the RTX 4090 host).
 *
 * Update a pin with the build: `pinBuild(dir, target)` prints the values, and test/pinned-build.test.ts fails
 * until they match the committed BUILDINFO.json (and the binaries, when the dist folder has them).
 */

export const FFMPEG_BUILD_TARGET_IDS = ['darwin-arm64', 'linux-x64'] as const;
export type FfmpegBuildTargetId = (typeof FFMPEG_BUILD_TARGET_IDS)[number];

export interface PinnedFfmpegBuild {
  /** sha256 of BUILDINFO.json. */
  readonly buildInfo: string;
  /**
   * By output name (ffmpeg, ffprobe, the Vulkan driver's files, the shared libraries): `signatureFreeSha256`,
   * which packaging's re-signing doesn't change (a Mach-O's signature; any other file is hashed whole).
   */
  readonly outputs: Readonly<Record<string, string>>;
}

/** One file of a build: its output name in BUILDINFO.json and its path under the build folder. */
export type BuildFile = readonly [name: string, path: string];

export interface FfmpegBuildTarget {
  readonly id: FfmpegBuildTargetId;
  /** What the binaries' `-version` prints, and BUILDINFO.json's `ffmpeg_version`. */
  readonly version: string;
  /** The development build's folder under tools/ffmpeg/dist ('' is dist itself). */
  readonly devFolder: string;
  /** The packaged sidecar's folder under the app's resources. */
  readonly resourcesFolder: string;
  /** ffmpeg's and ffprobe's folder, relative to the build folder ('' is the folder itself). */
  readonly binDir: string;
  /** Shared libraries the binaries load, pinned with them. */
  readonly libraries: readonly BuildFile[];
  /** A Vulkan driver that ships with the build (MoltenVK): its ICD and library. None: the system loader. */
  readonly vulkan?: { readonly icd: BuildFile; readonly library: BuildFile };
  readonly pinned: PinnedFfmpegBuild;
}

const LINUX_LIBRARIES: readonly BuildFile[] = [
  'libavcodec.so.63',
  'libavdevice.so.63',
  'libavfilter.so.12',
  'libavformat.so.63',
  'libavutil.so.61',
  'libswresample.so.7',
  'libswscale.so.10',
].map((name) => [name, `lib/${name}`] as const);

export const FFMPEG_BUILD_TARGETS: Readonly<Record<FfmpegBuildTargetId, FfmpegBuildTarget>> = {
  /** tools/ffmpeg/dist: FFmpeg 9.0.2, path-independent build of 2026-11-11 without static OpenH264. */
  'darwin-arm64': {
    id: 'darwin-arm64',
    version: '9.0.2',
    devFolder: '',
    resourcesFolder: 'bin',
    binDir: '',
    libraries: [],
    vulkan: {
      icd: ['MoltenVK_icd.json', 'lib/MoltenVK_icd.json'],
      library: ['libMoltenVK.dylib', 'lib/libMoltenVK.dylib'],
    },
    pinned: {
      buildInfo: 'c7aa508eb78f1e30d6ee6adc6a71ec251ca04cd65c96abbeb281cda68b6f0f81',
      outputs: {
        ffmpeg: '1e424bc98a45f2438e9b14971cd2f9e928b43a149762b6bce6ecd784c41fb4fa',
        ffprobe: '163552c810fc886c4d4cbf82791fffd66693d57d6963fc815c638af3ae92df7a',
        'MoltenVK_icd.json': '578ff08cd0d8734619357541771a5abc9c3470ca300030219a971a9e9dbbe466',
        'libMoltenVK.dylib': 'e0ae78d0b2edc89021abb34b1c933caa7c39b7caad312ed27b7555b65d4246eb',
      },
    },
  },
  /** tools/ffmpeg/dist/linux-x64: FFmpeg 9.0.2, tools/ffmpeg/build-linux.sh of 2026-10-27, reproduced twice. */
  'linux-x64': {
    id: 'linux-x64',
    version: '9.0.2',
    devFolder: 'linux-x64',
    resourcesFolder: 'ffmpeg',
    binDir: 'bin',
    libraries: LINUX_LIBRARIES,
    pinned: {
      buildInfo: 'bc13c439ceb05a428420874213ce7ab22615e0320aaad0248e94b80dbbe0d2f6',
      outputs: {
        ffmpeg: '1a64540023df511c011ab2b26b99bdcec711cda87ddc1597090ea25f561dc3ac',
        ffprobe: '0460b4f0ece7f6232db6d615e3243b4456eff45c1cf354b46fe88021645c1cb8',
        'libavcodec.so.63': 'a971861c077d0e4ef437fd861a6b598ffd37630468af213b90d51f6a398e41a3',
        'libavdevice.so.63': 'c24083b39802267359a41dd159ed8318a7e88ad7c04e57e59fa77649f907de4f',
        'libavfilter.so.12': '2b076e0e9f57f822396a2d3132853d53bf6868edf0a3ebf359fb866f41a3229e',
        'libavformat.so.63': '42d65e6edf1059284f842686fba1a319bac0137e7105350fed57f75c69307d67',
        'libavutil.so.61': 'd6c538f8bfc091398075741343c09881716f86c553fec753ae909511601a0c61',
        'libswresample.so.7': 'c07c94483d1df1eb9d95046cf72307e8b4435f8ca28fb691639196fef1616af9',
        'libswscale.so.10': '6d9c67cc41a32ddab6b9466c849423682592716943ba9f793b26c9f9d435f430',
      },
    },
  },
};

/** The build for a platform and architecture, or undefined where none ships. */
export function ffmpegBuildTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): FfmpegBuildTarget | undefined {
  return (FFMPEG_BUILD_TARGETS as Partial<Record<string, FfmpegBuildTarget>>)[`${platform}-${arch}`];
}

/**
 * Whether the platform's build brings its own Vulkan driver (MoltenVK on macOS), so a build without it can't run
 * libplacebo. Elsewhere libplacebo uses the system Vulkan loader and the GPU's ICD, and only a trial can tell.
 */
export function shipsVulkanDriver(platform: NodeJS.Platform = process.platform): boolean {
  return FFMPEG_BUILD_TARGET_IDS.some(
    (id) => id.startsWith(`${platform}-`) && FFMPEG_BUILD_TARGETS[id].vulkan,
  );
}

/** The macOS build's pin (the only one before Linux): kept for callers that name it. */
export const PINNED_FFMPEG_BUILD: PinnedFfmpegBuild = FFMPEG_BUILD_TARGETS['darwin-arm64'].pinned;

/** The binaries' paths relative to the build folder. */
export function binaryFiles(target: Pick<FfmpegBuildTarget, 'binDir'>): readonly BuildFile[] {
  const at = (name: string) => (target.binDir ? `${target.binDir}/${name}` : name);
  return [
    ['ffmpeg', at('ffmpeg')],
    ['ffprobe', at('ffprobe')],
  ];
}

/** Every pinned file of a build: the binaries, the libraries, then the Vulkan driver when it's there. */
export function bundleFiles(target: FfmpegBuildTarget, withVulkan: boolean): BuildFile[] {
  const vulkan = withVulkan && target.vulkan ? [target.vulkan.icd, target.vulkan.library] : [];
  return [...binaryFiles(target), ...target.libraries, ...vulkan];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The component manifest (G13): what can be downloaded, from where, with which
 * sha256, for which platform and hardware tier, under which licence. The JSON
 * Schema in tools/components/manifest.schema.json is generated from this file
 * (`pnpm --filter @taalcut/jobs run schema:export`).
 */
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { ManifestInvalid } from './errors';
import { LicenceAcceptanceSchema } from './acceptance';
import { ComponentRequiresSchema } from './requires';

/** PRD G14. P1-E4 detects the tier; core should own this type once both sides need it (see SPEC.md). */
export const HARDWARE_TIERS = ['minimum', 'recommended', 'high'] as const;
export type HardwareTier = (typeof HARDWARE_TIERS)[number];

export const COMPONENT_KINDS = ['runtime', 'model', 'tool'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** `<process.platform>-<process.arch>`, or 'any' for platform-independent files such as model weights. */
export const PLATFORM_KEYS = [
  'any',
  'darwin-arm64',
  'darwin-x64',
  'win32-arm64',
  'win32-x64',
  'linux-arm64',
  'linux-x64',
] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/** Node built-ins only: zlib does gzip and zstd. Re-host zip or bz2 upstreams as one of these. */
export const ARCHIVE_FORMATS = ['tar', 'tar.gz', 'tar.zst'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A manifest URL: https only, no credentials, no link-local address. Plain
 * http is allowed for loopback hosts so tests can use a local server.
 */
export function isAllowedDownloadUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.username || url.password || isLinkLocal(url.hostname)) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
}

/**
 * Where a redirect may lead: https only, loopback included (a remote mirror
 * must not reach a plain-http service on this machine), no credentials, no
 * link-local address.
 */
export function isAllowedRedirectUrl(value: string): boolean {
  const url = parseUrl(value);
  return url?.protocol === 'https:' && !url.username && !url.password && !isLinkLocal(url.hostname);
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** 169.254.0.0/16 and fe80::/10 (where cloud metadata services live), also as IPv4-mapped IPv6. */
function isLinkLocal(hostname: string): boolean {
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true;
  const v6 = /^\[(.+)\]$/.exec(hostname)?.[1]?.toLowerCase();
  if (!v6) return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(v6);
  return /^fe[89ab][0-9a-f]:/.test(v6) || (mapped !== null && parseInt(mapped[1]!, 16) === 0xa9fe);
}

/** CC BY licences (Parakeet is CC-BY-4.0) are void without attribution, so the manifest must carry it. */
export function requiresAttribution(spdx: string): boolean {
  return /(^|[\s(])CC-BY-/i.test(spdx);
}

const ComponentId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .describe('Stable kebab-case id, e.g. "onnxruntime". Used in paths and as the install idempotency key.');

const Version = z
  .string()
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/)
  .describe('Upstream version. Any change to it (or to sha256) means "update available".');

const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('Lowercase hex sha256 of the downloaded file (the archive itself for archives).');

const DownloadUrl = z
  .url()
  .refine(isAllowedDownloadUrl, { message: 'Use an https:// URL without credentials.' })
  .describe('https:// URL. Mirrors are tried in order and must serve identical bytes.');

const FileName = z
  .string()
  .max(255)
  // eslint-disable-next-line no-control-regex -- NUL is the one byte no file name may contain
  .regex(/^(?!\.\.?$)[^/\\\u0000]+$/)
  .describe('Name of the installed file inside the component folder. No slashes.');

const FileInstall = z.object({
  type: z.literal('file'),
  fileName: FileName,
  executable: z.boolean().default(false).describe('chmod 755 after install (CLI tools such as yt-dlp).'),
});

const ArchiveInstall = z.object({
  type: z.literal('archive'),
  format: z.enum(ARCHIVE_FORMATS),
  stripComponents: z
    .int()
    .min(0)
    .max(8)
    .default(0)
    .describe('Leading path segments to drop, like tar --strip-components.'),
  extractedSize: z
    .int()
    .positive()
    .describe(
      'Sum of the sizes of the regular files in the archive. Used for the disk check and as a hard cap.',
    ),
});

const InstallSpec = z.discriminatedUnion('type', [FileInstall, ArchiveInstall]);

const Artifact = z.object({
  platform: z.enum(PLATFORM_KEYS),
  urls: z.array(DownloadUrl).min(1).max(8),
  sha256: Sha256,
  size: z.int().positive().describe('Exact size of the downloaded file in bytes.'),
  install: InstallSpec,
});

/** Big enough for a component's every licence text (Chromium's is the largest), small enough to fetch whole. */
export const MAX_NOTICE_BYTES = 16 * 1024 * 1024;

const LicenceNotice = z
  .object({
    url: DownloadUrl.describe('https:// URL of the NOTICE.txt, beside the component it describes.'),
    size: z.int().positive().max(MAX_NOTICE_BYTES).describe('Exact size of the NOTICE.txt in bytes.'),
    sha256: Sha256.describe('Lowercase hex sha256 of the NOTICE.txt.'),
  })
  .describe(
    "The component's NOTICE.txt, hosted beside it and pinned like an artifact: its licence and attribution, what Taalcut changed, where the corresponding source of its copyleft pieces is, and the full text of every licence. Immutable: a changed notice gets a new key (its name carries its sha256); the component's version doesn't change.",
  );

/** A component's licence, as the manifest states it and the installed registry keeps it. */
export const ComponentLicenceSchema = z
  .object({
    spdx: z.string().min(1).max(120).describe('SPDX licence expression, e.g. "MIT" or "CC-BY-4.0".'),
    notice: LicenceNotice,
    attribution: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe('Credit line shown in Settings → About. Required for CC BY licences.'),
    acceptance: LicenceAcceptanceSchema.optional(),
  })
  .refine((licence) => !requiresAttribution(licence.spdx) || licence.attribution !== undefined, {
    message: 'This licence requires attribution text.',
    path: ['attribution'],
  });

const Component = z
  .object({
    id: ComponentId,
    name: z.string().min(1).max(80).describe('Product name, shown as is (not translated).'),
    version: Version,
    kind: z.enum(COMPONENT_KINDS),
    tiers: z
      .array(z.enum(HARDWARE_TIERS))
      .default([])
      .describe('Hardware tiers that install this by default. Empty: on demand only.'),
    licence: ComponentLicenceSchema,
    dependencies: z.array(ComponentId).default([]).describe('Component ids installed first.'),
    requires: ComponentRequiresSchema.optional(),
    variants: z
      .array(ComponentId)
      .max(8)
      .optional()
      .describe(
        'Accelerator builds that stand in for this one where they fit (requires), most preferred first; this one is the fallback. A variant has no tiers of its own: it is picked through this one.',
      ),
    artifacts: z.array(Artifact).min(1),
  })
  .superRefine((component, ctx) => {
    const platforms = component.artifacts.map((a) => a.platform);
    if (new Set(platforms).size !== platforms.length) {
      ctx.addIssue({ code: 'custom', message: 'One artifact per platform.', path: ['artifacts'] });
    }
    if (component.dependencies.includes(component.id)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A component cannot depend on itself.',
        path: ['dependencies'],
      });
    }
  });

export const ComponentManifestSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    schemaVersion: z.literal(1),
    sequence: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .describe(
        'Signed manifests: goes up with every publication. The app refuses one lower than the highest it has accepted (anti-rollback).',
      ),
    notAfter: z.iso
      .datetime()
      .optional()
      .describe(
        'Signed manifests: UTC time (ISO 8601, ending in Z) after which the app refuses this manifest.',
      ),
    components: z.array(Component),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    manifest.components.forEach((c, index) => {
      if (ids.has(c.id))
        ctx.addIssue({ code: 'custom', message: `Duplicate id '${c.id}'.`, path: ['components', index] });
      ids.add(c.id);
    });
    manifest.components.forEach((c, index) => {
      for (const dep of c.dependencies) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: 'custom',
            message: `Unknown dependency '${dep}'.`,
            path: ['components', index],
          });
        }
      }
    });
    checkVariants(manifest.components, ctx);
    const cycle = findCycle(manifest.components);
    if (cycle)
      ctx.addIssue({
        code: 'custom',
        message: `Dependency cycle: ${cycle.join(' → ')}.`,
        path: ['components'],
      });
  });

export type ComponentManifest = z.output<typeof ComponentManifestSchema>;
export type ComponentEntry = ComponentManifest['components'][number];
export type ComponentArtifact = ComponentEntry['artifacts'][number];
export type InstallSpec = ComponentArtifact['install'];
export type ComponentLicence = ComponentEntry['licence'];
export type ComponentLicenceNotice = ComponentLicence['notice'];
export type { LicenceAcceptance } from './acceptance';

/** Validates untrusted manifest JSON (parsed) and returns it with defaults filled in. */
export function parseManifest(json: unknown): Result<ComponentManifest> {
  const parsed = ComponentManifestSchema.safeParse(json);
  if (parsed.success) return ok(parsed.data);
  return err(ManifestInvalid(undefined, { detail: z.prettifyError(parsed.error) }));
}

/** The JSON Schema for manifest files (input shape: fields with defaults are optional). */
export function manifestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ComponentManifestSchema, { io: 'input' }) as Record<string, unknown>;
  return {
    $schema: schema.$schema,
    $id: 'urn:taalcut:component-manifest:1',
    title: 'Taalcut component manifest',
    description:
      'Downloadable runtimes, models and tools (PRD G13). Generated from packages/jobs; do not edit.',
    ...schema,
  };
}

/**
 * Each variant is a known component, belongs to one base only, has no variants of its own (a group is one level
 * deep) and no tiers (it is picked through its base, so an older build that ignores `variants` never installs it).
 */
function checkVariants(
  components: readonly { id: string; tiers: readonly string[]; variants?: readonly string[] | undefined }[],
  ctx: z.RefinementCtx,
): void {
  const byId = new Map(components.map((c) => [c.id, c]));
  const baseOf = new Map<string, string>();
  components.forEach((c, index) => {
    for (const id of c.variants ?? []) {
      const variant = byId.get(id);
      const problem =
        id === c.id
          ? 'A component cannot be its own variant.'
          : !variant
            ? `Unknown variant '${id}'.`
            : baseOf.has(id)
              ? `'${id}' is a variant of '${baseOf.get(id)!}' already.`
              : (variant.variants?.length ?? 0) > 0
                ? `Variant '${id}' has variants of its own.`
                : variant.tiers.length > 0
                  ? `Variant '${id}' has tiers; it is picked through '${c.id}'.`
                  : undefined;
      if (problem)
        ctx.addIssue({ code: 'custom', message: problem, path: ['components', index, 'variants'] });
      baseOf.set(id, c.id);
    }
  });
}

/** Returns one cycle as a list of ids (first id repeated at the end), or undefined. */
function findCycle(
  components: readonly { id: string; dependencies: readonly string[] }[],
): string[] | undefined {
  const deps = new Map(components.map((c) => [c.id, c.dependencies]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === 'done') return undefined;
    if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return undefined;
  };
  for (const c of components) {
    const cycle = visit(c.id);
    if (cycle) return cycle;
  }
  return undefined;
}

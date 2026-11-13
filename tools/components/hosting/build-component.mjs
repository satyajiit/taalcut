// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One component through the release path: its files, one per platform (the manifest's own bytes when they are
 * cached and pass the signing policy, else built by their recipes), checked (signatures, extracted size), placed at
 * their keys with the corresponding sources (sources.mjs) and one notice (`NOTICE-<sha256 prefix>.txt`) that lists
 * them, and described for release.json, a record per file.
 */
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extract } from './archive.mjs';
import { machOFiles, TAALCUT_TEAM, treeProblems } from './codesign.mjs';
import { listEntries, regularBytes, sha256File, sha256Hex } from './files.mjs';
import { noticeText } from './notice.mjs';
import { cacheControl, contentType, noticeFile, objectKey, publicUrl } from './objects.mjs';
import { artifactPlan, artifactPlanProblems, noticeParts } from './artifacts.mjs';
import { addToCache, cached, pinned } from './pinned.mjs';
import { HOSTED_REPO_SOURCES, PUBLIC_BASE } from './plan.mjs';
import { RECIPES } from './recipes.mjs';
import { sourcePath } from './sources.mjs';

/**
 * The signing policy's verdict on an unpacked artifact: how many Mach-O files, and what's wrong (empty: passes).
 * Taalcut's signatures carry no entitlement but the ones the plan allows by path; an upstream team's are its own.
 */
async function policy(root, entries, signature, entitlements = {}) {
  const team = signature === 'taalcut' || signature === 'none' ? TAALCUT_TEAM : signature.team;
  const options = signature === 'taalcut' ? { entitlements } : {};
  const { count, problems } = await treeProblems(root, entries, team, options);
  if (signature === 'none')
    return { count, problems: count === 0 ? [] : [`${count} Mach-O file(s) where none may be`] };
  return { count, problems: count === 0 ? ['no Mach-O file to check'] : problems };
}

/**
 * Unpacks (or links) the artifact into a scratch folder and measures and checks it. `checked` false: another
 * platform's file, the manifest's own bytes by sha256, checked on the host that built it (this one may have no
 * codesign); only its Mach-O files are counted.
 */
async function inspect(path, install, { signature, entitlements }, scratch, checked = true) {
  const root = join(scratch, 'inspect');
  if (install.type === 'archive') await extract(path, install.format, root);
  else {
    await mkdir(root, { recursive: true });
    await copyFile(path, join(root, install.fileName), constants.COPYFILE_FICLONE);
  }
  const entries = await listEntries(root);
  const extractedSize = install.type === 'archive' ? await regularBytes(root, entries) : undefined;
  if (!checked)
    return { root, entries, extractedSize, count: (await machOFiles(root, entries)).length, problems: [] };
  return { root, entries, extractedSize, ...(await policy(root, entries, signature, entitlements)) };
}

function sameInstallKind(manifestInstall, planned) {
  if (manifestInstall.type !== planned.type) return false;
  return manifestInstall.type === 'file' || manifestInstall.format === planned.format;
}

/** Notices generated from a component's own build inputs (Deno's, from its Cargo.lock). */
const GENERATED = {
  deno: async (ctx) => {
    const { denoNoticeSections } = await import('../deno/notice.mjs');
    const { sections, summary } = await denoNoticeSections({ pinOptions: ctx.pinOptions });
    ctx.log(`deno: notice from ${summary}`);
    return sections;
  },
};

/** The licence texts the notice quotes from pinned files, the repository and the generated notices. */
async function textSections(ctx, notice) {
  const sections = [];
  for (const text of notice.texts ?? [])
    sections.push({ title: text.title, text: await readFile(await pinned(text, ctx.pinOptions), 'utf8') });
  for (const file of notice.repoTexts ?? [])
    sections.push({ title: file.title, text: await readFile(join(ctx.repo, file.path), 'utf8') });
  return sections;
}

/** The texts the notice quotes from another platform's artifact, titled with its platform. */
async function artifactSections(notice, inspected, platform) {
  const sections = [];
  for (const file of notice.inArtifact ?? [])
    sections.push({
      title: `${file.title} (${platform})`,
      text: await readFile(join(inspected.root, file.path), 'utf8'),
    });
  if (notice.inArtifactDir) {
    const prefix = `${notice.inArtifactDir}/`;
    for (const path of inspected.entries.filter((entry) => entry.startsWith(prefix)))
      sections.push({
        title: `${path} (from the ${platform} archive)`,
        text: await readFile(join(inspected.root, path), 'utf8'),
      });
  }
  return sections;
}

/**
 * Every section of the notice: the texts, what the component's own artifact holds, the generated ones, then what
 * each other platform's artifact holds (titled with its platform). One artifact: exactly the sections it always had.
 */
async function noticeSections(ctx, plan, notice, made) {
  const [own, ...others] = made;
  const sections = await textSections(ctx, notice);
  for (const file of plan.notice.inArtifact ?? [])
    sections.push({ title: file.title, text: await readFile(join(own.inspected.root, file.path), 'utf8') });
  if (plan.notice.generated) sections.push(...(await GENERATED[plan.notice.generated](ctx)));
  if (plan.notice.inArtifactDir) {
    const prefix = `${plan.notice.inArtifactDir}/`;
    for (const path of own.inspected.entries.filter((entry) => entry.startsWith(prefix)))
      sections.push({
        title: `${path} (from the archive)`,
        text: await readFile(join(own.inspected.root, path), 'utf8'),
      });
  }
  for (const other of others) {
    const extra = plan.platforms?.[other.platform]?.notice;
    if (extra) sections.push(...(await artifactSections(extra, other.inspected, other.platform)));
  }
  return sections;
}

async function place(out, key, from) {
  const target = join(out, 'objects', key);
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { force: true });
  await copyFile(from, target, constants.COPYFILE_FICLONE);
  return target;
}

async function describe(out, key, path) {
  const { size } = await stat(path);
  return {
    key,
    path,
    size,
    sha256: await sha256File(path),
    contentType: contentType(key),
    cacheControl: cacheControl(key),
  };
}

/**
 * One artifact's file: the manifest's own bytes when the sha256 cache holds them and they pass the signing policy,
 * else (for a platform this run builds) built by its recipe, else (another platform's, built on its own kind of host)
 * the hosted file the manifest names. Returns { platform, key, path, install, inspected, elsewhere? }.
 */
async function makeArtifact(component, artifact, plan, scratch, ctx) {
  const key = objectKey(component.id, component.version, plan.file);
  const work = join(scratch, artifact.platform);
  const fileInstall = artifact.install.type === 'file' ? artifact.install : undefined;
  const recipeCtx = { ...ctx, id: component.id, file: plan.file, fileInstall, stage: join(work, 'stage') };
  await mkdir(recipeCtx.stage, { recursive: true });
  const label = component.artifacts.length > 1 ? `${component.id} (${artifact.platform})` : component.id;
  const here = !ctx.platforms || ctx.platforms.has(artifact.platform);

  let reusable = !ctx.rebuild.has(component.id) && (await cached(ctx.pinOptions.cacheDir, artifact.sha256));
  if (!reusable && !here) {
    ctx.log(`${label}: built on a ${artifact.platform} host; taking the hosted file`);
    const pin = { url: artifact.urls[0], size: artifact.size, sha256: artifact.sha256 };
    reusable = await pinned(pin, ctx.pinOptions);
  }
  if (reusable) {
    const planned = planInstall(plan, artifact.install);
    if (sameInstallKind(artifact.install, planned)) {
      const inspected = await inspect(reusable, planned, plan, join(work, 'reuse'), here);
      if (inspected.problems.length === 0)
        return {
          platform: artifact.platform,
          key,
          path: reusable,
          install: planned,
          inspected,
          elsewhere: !here,
        };
      ctx.log(`${label}: the manifest's file fails the policy (${inspected.problems[0]}); building`);
    }
  }
  if (!here) throw new Error(`${label}: build it on a ${artifact.platform} host (build.mjs --platform)`);
  ctx.log(`${label}: building (${plan.recipe.kind})`);
  const built = await RECIPES[plan.recipe.kind](recipeCtx, plan.recipe);
  const inspected = await inspect(built.path, built.install, plan, join(work, 'built'));
  if (inspected.problems.length > 0)
    throw new Error(`${label}: the built file fails the policy:\n  ${inspected.problems.join('\n  ')}`);
  const cachedPath = await addToCache(ctx.pinOptions.cacheDir, built.path);
  const same = cachedPath.endsWith(`/${artifact.sha256}`);
  ctx.log(`${label}: ${same ? "reproduced the manifest's bytes" : 'new bytes (the manifest names others)'}`);
  return { platform: artifact.platform, key, ...built, inspected };
}

/**
 * Builds `component` (the manifest entry) with `plan` into `out`: every artifact (artifacts.mjs), its corresponding
 * sources and one notice that names them all. `ctx` carries repo, identity, pinOptions, rebuild (a Set of ids),
 * platforms (a Set: the platforms this run builds; absent: all), memo, log and the cross-component helpers
 * artifactPath/unpacked. Returns { components: one release record per artifact, objects }.
 */
export async function buildComponent(component, plan, out, ctx) {
  const problems = artifactPlanProblems(component, plan);
  if (problems.length > 0) throw new Error(problems.join('; '));
  // The component's own artifact first: the notice quotes what it holds.
  const ordered = [...component.artifacts].sort(
    (a, b) => Number(Boolean(plan.platforms?.[a.platform])) - Number(Boolean(plan.platforms?.[b.platform])),
  );
  const scratch = await mkdtemp(join(out, '.work-'));
  try {
    const made = [];
    for (const artifact of ordered)
      made.push(await makeArtifact(component, artifact, artifactPlan(plan, artifact.platform), scratch, ctx));
    const objects = [];
    for (const each of made) {
      const install = { ...each.install };
      if (install.type === 'archive') install.extractedSize = each.inspected.extractedSize;
      each.install = install;
      each.object = await describe(out, each.key, await place(out, each.key, each.path));
      objects.push(each.object);
    }
    const sources = [];
    const plans = made.map((each) => artifactPlan(plan, each.platform));
    const sourcePlans = [...new Map(plans.flatMap((p) => p.sources ?? []).map((s) => [s.file, s])).values()];
    for (const source of sourcePlans) {
      const sourceKey = objectKey(component.id, component.version, source.file);
      const from = await sourcePath(source, {
        key: sourceKey,
        base: PUBLIC_BASE,
        hosted: HOSTED_REPO_SOURCES,
        repo: ctx.repo,
        pinOptions: ctx.pinOptions,
        scratch,
      });
      const object = await describe(out, sourceKey, await place(out, sourceKey, from));
      objects.push(object);
      sources.push({
        url: publicUrl(PUBLIC_BASE, sourceKey),
        size: object.size,
        sha256: object.sha256,
        what: source.what,
      });
    }
    const notice = noticeParts(
      plan,
      made.map((each) => each.platform),
    );
    const urls = made.map((each) => publicUrl(PUBLIC_BASE, each.key));
    const text = noticeText({
      component,
      url: urls.length === 1 ? urls[0] : urls,
      changes: notice.changes,
      extra: notice.extra,
      sources,
      sections: await noticeSections(ctx, plan, notice, made),
    });
    const noticeKey = objectKey(component.id, component.version, noticeFile(sha256Hex(text)));
    const noticePath = join(out, 'objects', noticeKey);
    await mkdir(dirname(noticePath), { recursive: true });
    await writeFile(noticePath, text);
    const noticeObject = await describe(out, noticeKey, noticePath);
    objects.push(noticeObject);
    const noticePin = {
      url: publicUrl(PUBLIC_BASE, noticeKey),
      size: noticeObject.size,
      sha256: noticeObject.sha256,
    };
    return {
      components: made.map((each) => ({
        id: component.id,
        version: component.version,
        platform: each.platform,
        url: publicUrl(PUBLIC_BASE, each.key),
        sha256: each.object.sha256,
        size: each.object.size,
        install: each.install,
        notice: noticePin,
        machO: each.inspected.count,
        // Built (and notarised) on its own kind of host, and hosted already: nothing for this run to submit.
        ...(each.elsewhere ? { elsewhere: true } : {}),
      })),
      objects,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The install spec the plan produces, for comparing with the manifest's before reusing its bytes. */
function planInstall(plan, manifestInstall) {
  const recipe = plan.recipe;
  if (recipe.kind === 'upstream')
    return recipe.format
      ? { type: 'archive', format: recipe.format, stripComponents: recipe.stripComponents ?? 0 }
      : manifestInstall;
  if (recipe.kind === 'whisper' || (recipe.kind === 'script' && manifestInstall.type === 'file'))
    return manifestInstall;
  return { type: 'archive', format: 'tar.zst', stripComponents: recipe.stripComponents ?? 0 };
}

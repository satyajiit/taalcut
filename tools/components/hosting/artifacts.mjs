// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A component with more than one artifact (LNX1-CMP: onnxruntime for darwin-arm64 and linux-x64). Its plan is the
 * plan of one artifact, and `platforms` holds the others: each one's file, signature and recipe, and what its
 * notice adds. A component has one notice whatever its platforms (the manifest pins it once), so the notice names
 * every artifact and says what was done to each.
 *
 *   'local-llm-runtime': { file, signature, recipe, notice, platforms: { 'linux-x64': { file, signature, recipe,
 *     notice: { changes, extra, texts } } } }
 */

/** The plan for `platform`'s artifact: its `platforms` entry over the component's own plan, or that plan. */
export function artifactPlan(plan, platform) {
  const extra = plan.platforms?.[platform];
  if (!extra) return plan;
  const { platforms: _platforms, ...base } = plan;
  return {
    ...base,
    ...extra,
    notice: plan.notice,
    sources: [...(plan.sources ?? []), ...(extra.sources ?? [])],
  };
}

/** What is wrong with `plan` for `component`'s artifacts: every one has a plan, and every platform entry an artifact. */
export function artifactPlanProblems(component, plan) {
  const platforms = component.artifacts.map((artifact) => artifact.platform);
  const own = platforms.filter((platform) => !plan.platforms?.[platform]);
  const problems = [];
  if (own.length > 1)
    problems.push(`${component.id}: ${own.join(', ')} share one plan; give all but one a platforms entry`);
  for (const platform of Object.keys(plan.platforms ?? {}))
    if (!platforms.includes(platform)) problems.push(`${component.id}: no ${platform} artifact for its plan`);
  return problems;
}

/** The notice's parts for every artifact: the component's, then each platform's, each text once. */
export function noticeParts(plan, platforms) {
  const changes = [...plan.notice.changes];
  const extra = [...(plan.notice.extra ?? [])];
  const texts = [...(plan.notice.texts ?? [])];
  for (const platform of platforms) {
    const own = plan.platforms?.[platform]?.notice;
    if (!own) continue;
    changes.push(...own.changes);
    extra.push(...(own.extra ?? []));
    for (const text of own.texts ?? []) if (!texts.some((t) => t.title === text.title)) texts.push(text);
  }
  return { ...plan.notice, changes, extra, texts };
}

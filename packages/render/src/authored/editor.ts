// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  buildDocument,
  flatElements,
  openComposition,
  type Composition,
  type EditOp,
  type HyperFramesElement,
} from '@hyperframes/sdk';
import { parseGsapScriptAcorn } from '@hyperframes/parsers/gsap-parser-acorn';
import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
  type AuthoredEdit,
  type AuthoredInspection,
  type AuthoredProgram,
  type Result,
} from '@taalcut/core';
import { prepareAuthoredProgram } from './prepare';
import { assetReferences } from '../workspace/gate/assets';
import { authoredSourceDuration } from './duration';

const invalid = (detail: string) =>
  err(ValidationError({ field: 'authoredProgram' }, { detail: detail.slice(0, 2000) }));
const seconds = RationalTime.toSeconds;

/** Re-derived from source on every read; there is no separately persisted editor document. */
export function inspectAuthoredProgram(
  source: string,
  program: AuthoredProgram,
  options: { readonly updateDuration?: boolean } = {},
): Result<AuthoredInspection> {
  const prepared = prepareAuthoredProgram(source);
  if (!prepared.ok)
    return invalid(
      prepared.findings.map((finding) => `${finding.code}: ${finding.message} ${finding.fixHint}`).join('\n'),
    );
  if (assetReferences(prepared.value).some((path) => !program.files.some((file) => file.path === path)))
    return invalid('An image referenced by the source is absent from the program bundle.');
  const manifest = options.updateDuration
    ? authoredSourceDuration(program, prepared.value.doc.durationSeconds)
    : program;
  if (
    prepared.value.doc.width !== program.canvas.width ||
    prepared.value.doc.height !== program.canvas.height ||
    Math.abs(prepared.value.doc.durationSeconds - seconds(manifest.duration)) > 1 / 60000
  )
    return invalid('Source canvas and duration must agree with the program manifest.');
  try {
    const document = buildDocument(source);
    const elements = flatElements(document.roots);
    const parent = new Map<string, string>();
    const visit = (element: HyperFramesElement) => {
      for (const child of element.children) {
        parent.set(child.scopedId, element.scopedId);
        visit(child);
      }
    };
    document.roots.forEach(visit);
    const time = (value: number) =>
      RationalTime.of(
        Math.round((value * program.canvas.rate.num) / program.canvas.rate.den),
        program.canvas.rate,
      );
    return ok({
      program: manifest,
      source: document.html,
      elements: elements.map((element) => ({
        id: element.scopedId,
        parentId: parent.get(element.scopedId) ?? null,
        tag: element.tag,
        text: element.text,
        styles: { ...element.inlineStyles },
        attributes: { ...element.attributes },
        start: element.start === null ? null : time(element.start),
        // SDK 0.8.209 reads legacy data-end but writes canonical data-duration.
        duration:
          element.attributes['data-duration'] !== undefined
            ? time(Number(element.attributes['data-duration']))
            : element.duration === null
              ? null
              : time(element.duration),
        animationIds: [...element.animationIds],
      })),
      animations: parseGsapScriptAcorn(document.gsapScript ?? '').animations.map((animation) => ({
        id: animation.id,
        method: animation.method,
        targets: elements
          .filter((element) => element.animationIds.includes(animation.id))
          .map((element) => element.scopedId),
        at: time(
          animation.resolvedStart ?? (typeof animation.position === 'number' ? animation.position : 0),
        ),
        duration: time(animation.duration ?? (animation.method === 'set' ? 0 : 0.5)),
        ease: animation.ease ?? 'power1.out',
        from: { ...(animation.method === 'from' ? animation.properties : animation.fromProperties) },
        to: { ...(animation.method === 'from' ? {} : animation.properties) },
        ...(animation.keyframes
          ? {
              keyframes: animation.keyframes.keyframes.map((frame) => ({
                position: frame.percentage,
                values: frame.properties,
                ...(frame.ease ? { ease: frame.ease } : {}),
              })),
            }
          : {}),
        ...(animation.arcPath
          ? {
              path: {
                autoRotate: animation.arcPath.autoRotate,
                segments: animation.arcPath.segments.map(({ cp1, cp2 }) => ({
                  ...(cp1 ? { cp1 } : {}),
                  ...(cp2 ? { cp2 } : {}),
                })),
              },
            }
          : {}),
      })),
    });
  } catch {
    return invalid('The SDK could not inspect this source.');
  }
}

function operation(edit: AuthoredEdit): EditOp {
  switch (edit.kind) {
    case 'text':
      return { type: 'setText', target: edit.target, value: edit.text };
    case 'style':
      return { type: 'setStyle', target: edit.target, styles: edit.styles };
    case 'attribute':
      return { type: 'setAttribute', target: edit.target, name: edit.name, value: edit.value };
    case 'timing':
      return {
        type: 'setTiming',
        target: edit.target,
        ...(edit.start ? { start: seconds(edit.start) } : {}),
        ...(edit.duration ? { duration: seconds(edit.duration) } : {}),
      };
    case 'remove':
      return { type: 'removeElement', target: edit.target };
    case 'add':
      return { type: 'addElement', parent: edit.parent, index: edit.index, html: edit.html };
    case 'order':
      return { type: 'reorderElements', entries: [{ target: edit.target, zIndex: edit.zIndex }] };
    case 'tween': {
      const method = edit.method ?? (edit.from ? 'fromTo' : 'to');
      const tween = {
        method,
        position: seconds(edit.at),
        duration: seconds(edit.duration),
        ease: edit.ease,
        ...(method === 'fromTo'
          ? { fromProperties: edit.from ?? {}, toProperties: edit.to }
          : { properties: method === 'from' ? (edit.from ?? edit.to) : edit.to }),
      };
      return edit.animationId
        ? { type: 'setGsapTween', animationId: edit.animationId, properties: tween }
        : { type: 'addGsapTween', target: edit.target, tween };
    }
    case 'removeTween':
      return { type: 'removeGsapTween', animationId: edit.animationId };
    case 'removeKeyframe':
      return { type: 'removeGsapKeyframe', animationId: edit.animationId, percentage: edit.position };
    case 'removePath':
      return { type: 'removeArcPath', animationId: edit.animationId };
    case 'keyframe':
      return {
        type: 'setGsapKeyframe',
        animationId: edit.animationId,
        keyframeIndex: edit.index,
        position: edit.position,
        value: edit.values,
        ...(edit.ease ? { ease: edit.ease } : {}),
      };
    case 'path':
      return {
        type: 'setArcPath',
        animationId: edit.animationId,
        config: { enabled: true, autoRotate: edit.autoRotate, segments: edit.segments },
      };
  }
}

/** A disposable SDK transaction. Only its validated serialized source may enter the host command transaction. */
export async function editAuthoredProgram(
  source: string,
  program: AuthoredProgram,
  edits: readonly AuthoredEdit[],
): AsyncResult<AuthoredInspection> {
  const before = inspectAuthoredProgram(source, program);
  if (!before.ok) return before;
  let composition: Composition | undefined;
  try {
    composition = await openComposition(before.value.source, { history: false });
    for (const edit of edits) {
      let op = operation(edit);
      if (op.type === 'addElement' && op.parent === null) {
        const root = composition.getRootElements()[0];
        if (!root) return invalid('The program has no editable root.');
        op = { ...op, parent: root.scopedId };
      }
      if (edit.kind === 'timing') {
        const element = composition.getElement(edit.target);
        const start = edit.start ? seconds(edit.start) : Number(element?.attributes['data-start'] ?? 0);
        const duration = edit.duration
          ? seconds(edit.duration)
          : Number(element?.attributes['data-duration'] ?? seconds(program.duration) - start);
        op = { type: 'setTiming', target: edit.target, start, duration };
        if (element && !element.classNames.includes('clip'))
          composition.dispatch({
            type: 'setAttribute',
            target: edit.target,
            name: 'class',
            value: [...element.classNames, 'clip'].join(' '),
          });
      }
      if (edit.kind === 'remove') {
        const element = composition.getElement(edit.target);
        const removed = new Set<string>();
        const visit = (node: HyperFramesElement) => {
          removed.add(node.scopedId);
          node.children.forEach(visit);
        };
        if (element) visit(element);
        // Shared selector tweens stay for the surviving layers; exclusively deleted targets leave no dangling call.
        for (let count = 0; count < 5000; count++) {
          const elements = composition.getElements();
          const animationId = [...composition.getAllAnimationIds()].find((id) => {
            const targets = elements.filter((candidate) => candidate.animationIds.includes(id));
            return targets.length > 0 && targets.every((candidate) => removed.has(candidate.scopedId));
          });
          if (!animationId) break;
          composition.dispatch({ type: 'removeGsapTween', animationId });
        }
      }
      if (edit.kind === 'keyframe') {
        const animation = parseGsapScriptAcorn(
          buildDocument(composition.serialize()).gsapScript ?? '',
        ).animations.find((candidate) => candidate.id === edit.animationId);
        if (!animation) return invalid('The animation changed. Re-inspect before editing its keyframes.');
        if (!animation.keyframes)
          composition.dispatch({ type: 'convertToKeyframes', animationId: edit.animationId });
        const current = parseGsapScriptAcorn(
          buildDocument(composition.serialize()).gsapScript ?? '',
        ).animations.find(
          (candidate) =>
            candidate.id === edit.animationId ||
            (candidate.targetSelector === animation.targetSelector &&
              candidate.resolvedStart === animation.resolvedStart),
        );
        if (!current) return invalid('The animation cannot be converted into editable keyframes.');
        op = {
          type: 'setGsapKeyframe',
          animationId: current.id,
          keyframeIndex: edit.index,
          position: edit.position,
          value: edit.values,
          ...(edit.ease ? { ease: edit.ease } : {}),
        };
        if (edit.index >= (current.keyframes?.keyframes.length ?? 0))
          op = {
            type: 'addGsapKeyframe',
            animationId: current.id,
            position: edit.position,
            value: edit.values,
          };
      }
      const can = composition.can(op);
      if (!can.ok) return invalid(`${can.code}: ${can.message}`);
      composition.dispatch(op);
    }
    return inspectAuthoredProgram(composition.serialize({ stripRuntime: true }), program);
  } catch {
    return invalid(
      'This edit is not supported by the current source. Re-inspect before editing a changed animation.',
    );
  } finally {
    composition?.dispose();
  }
}

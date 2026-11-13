// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type AuthoredEdit, type AuthoredInspection } from '@taalcut/core';

export function editCreationFixture(inspection: AuthoredInspection, edits: AuthoredEdit[]) {
  for (const edit of edits) {
    const element =
      'target' in edit ? inspection.elements.find((item) => item.id === edit.target) : undefined;
    if (edit.kind === 'text' && element) element.text = edit.text;
    if (edit.kind === 'style' && element)
      for (const [key, value] of Object.entries(edit.styles)) {
        if (value === null) delete element.styles[key];
        else element.styles[key] = value;
      }
    if (edit.kind === 'attribute' && element) {
      if (edit.value === null) delete element.attributes[edit.name];
      else element.attributes[edit.name] = edit.value;
    }
    if (edit.kind === 'order' && element) element.styles['z-index'] = String(edit.zIndex);
    if (edit.kind === 'timing' && element) {
      element.start = edit.start ?? element.start;
      element.duration = edit.duration ?? element.duration;
    }
    if (edit.kind === 'remove') inspection.elements = inspection.elements.filter((item) => item !== element);
    if (edit.kind === 'removeTween')
      inspection.animations = inspection.animations.filter((item) => item.id !== edit.animationId);
    if (edit.kind === 'add') {
      const document = new DOMParser().parseFromString(edit.html, 'text/html');
      for (const node of document.body.children)
        inspection.elements.push({
          id: `#${node.id || `layer-${inspection.elements.length}`}`,
          parentId: edit.parent,
          tag: node.tagName.toLowerCase(),
          text: node.textContent,
          styles: {},
          attributes: Object.fromEntries(
            [...node.attributes].map((attribute) => [attribute.name, attribute.value]),
          ),
          start: null,
          duration: null,
          animationIds: [],
        });
    }
    if (edit.kind === 'tween') {
      const animation = {
        id: edit.animationId ?? `motion-${inspection.animations.length}`,
        method: edit.method ?? (edit.from ? ('fromTo' as const) : ('to' as const)),
        targets: [edit.target],
        at: edit.at,
        duration: edit.duration,
        ease: edit.ease,
        from: edit.from ?? {},
        to: edit.to,
      };
      inspection.animations = [
        ...inspection.animations.filter((item) => item.id !== animation.id),
        animation,
      ];
    }
    if (edit.kind === 'removePath' || edit.kind === 'removeKeyframe') {
      const animation = inspection.animations.find((item) => item.id === edit.animationId);
      if (animation && edit.kind === 'removePath') delete animation.path;
      if (animation && edit.kind === 'removeKeyframe')
        animation.keyframes = animation.keyframes?.filter((frame) => frame.position !== edit.position) ?? [];
    }
    if (edit.kind === 'path' || edit.kind === 'keyframe') {
      const animation = inspection.animations.find((item) => item.id === edit.animationId);
      if (animation && edit.kind === 'path')
        animation.path = { segments: edit.segments, autoRotate: edit.autoRotate };
      if (animation && edit.kind === 'keyframe') {
        const frames = animation.keyframes ?? [];
        frames.splice(edit.index, 1, {
          position: edit.position,
          values: edit.values,
          ...(edit.ease ? { ease: edit.ease } : {}),
        });
        animation.keyframes = frames;
      }
    }
  }
}

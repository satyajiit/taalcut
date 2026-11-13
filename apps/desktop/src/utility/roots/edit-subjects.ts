// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL: the subject source the timeline's edit commands place overlays with after a swap, a recast or new
 * words, read from the container when an edit asks (render's root registers it, FRM1-SUB). Without one the
 * overlays keep the reel's relation with nobody known on screen, and render's layout still keeps them off heads.
 */
import {
  err,
  NotFoundError,
  ok,
  SubjectSourceToken,
  type Container,
  type SubjectSource,
} from '@taalcut/core';

export function editSubjects(container: Container): SubjectSource {
  return {
    over: (clip, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).over(clip, signal)
        : Promise.resolve(ok(undefined)),
    ensure: (ranges, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).ensure(ranges, signal)
        : Promise.resolve(err(NotFoundError({ entity: 'subjectSource' }))),
  };
}

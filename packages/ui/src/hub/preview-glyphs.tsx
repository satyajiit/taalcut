// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The StructurePreview's shot-type and camera-motion glyphs, and the neutral tone each shot type gets (U6). */
import type { HubStructure } from '@taalcut/core';
import {
  Crosshair,
  Eye,
  Focus,
  Footprints,
  Hand,
  Mountain,
  MoveHorizontal,
  MoveVertical,
  Plane,
  ScanFace,
  Smartphone,
  Type,
  User,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';

type Intent = HubStructure['slots'][number]['intent'];
export type ShotType = NonNullable<Intent['shotType']>;
export type CameraMotion = NonNullable<Intent['motion']>;

export const SHOT_GLYPHS: Readonly<Record<ShotType, LucideIcon>> = {
  wide: Mountain,
  medium: User,
  close: ScanFace,
  detail: Focus,
  pov: Eye,
  aerial: Plane,
  screen: Smartphone,
  text: Type,
};

export const MOTION_GLYPHS: Readonly<Record<CameraMotion, LucideIcon>> = {
  static: Crosshair,
  pan: MoveHorizontal,
  tilt: MoveVertical,
  'push-in': ZoomIn,
  'pull-out': ZoomOut,
  handheld: Hand,
  tracking: Footprints,
};

/** A neutral block per shot type on the viewer grey: lighter for wider shots, never a hue. */
export const SHOT_TONES: Readonly<Record<ShotType | 'none', string>> = {
  aerial: 'bg-viewer-rule',
  wide: 'bg-viewer-rule/95',
  pov: 'bg-viewer-rule/90',
  medium: 'bg-viewer-rule/85',
  text: 'bg-viewer-rule/80',
  close: 'bg-viewer-rule/75',
  detail: 'bg-viewer-rule/70',
  screen: 'bg-viewer-rule/65',
  none: 'bg-viewer-rule/80',
};

/** Ink on the viewer grey, which stays dark in both themes. */
export const VIEWER_INK = 'text-viewer-ink';
export const VIEWER_INK_2 = 'text-viewer-ink-2';

/**
 * The camera's move as a transform of the block, `progress` 0–1 through the slot: a slow push, pull, pan, tilt
 * or drift. Transform only; none under reduced motion (the caller passes 0 then).
 */
/* eslint-disable lingui/no-unlocalized-strings -- CSS transform values, never shown */
export function cameraTransform(motion: CameraMotion | null, progress: number): string | undefined {
  const p = Math.min(1, Math.max(0, progress));
  switch (motion) {
    case 'push-in':
      return `scale(${1 + 0.08 * p})`;
    case 'pull-out':
      return `scale(${1.08 - 0.08 * p})`;
    case 'pan':
    case 'tracking':
      return `scale(1.08) translateX(${(p - 0.5) * 6}%)`;
    case 'tilt':
      return `scale(1.08) translateY(${(p - 0.5) * 6}%)`;
    case 'handheld':
      return `scale(1.04) translate(${Math.sin(p * 9) * 0.8}%, ${Math.cos(p * 7) * 0.6}%)`;
    default:
      return undefined;
  }
}
/* eslint-enable lingui/no-unlocalized-strings */

/** Enough steps that the handheld drift's curve reads as a curve; the straight moves only need their ends. */
const HANDHELD_STEPS = 24;

/**
 * The camera's move over the whole slot as keyframes, for one Web Animation (UX4 B18: the compositor plays it, so
 * nothing re-renders per frame). Null when the camera holds still.
 */
export function cameraFrames(motion: CameraMotion | null): Keyframe[] | null {
  if (cameraTransform(motion, 0) === undefined) return null;
  const steps = motion === 'handheld' ? HANDHELD_STEPS : 1;
  return Array.from({ length: steps + 1 }, (_, step) => ({
    transform: cameraTransform(motion, step / steps) ?? 'none',
  }));
}

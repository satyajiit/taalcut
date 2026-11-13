// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text boxes for format plans. Every one sits inside the cross-post safe rect
 * (presets/safe-zones.v1.json: 120–780 × 288–1248 on the 1080 × 1920 canvas).
 * Lower thirds occupy y 0.56–0.62. Title and label keep the P2 numbers.
 */
export const SAFE_RECT = {
  left: 120 / 1080,
  top: 288 / 1920,
  right: 780 / 1080,
  bottom: 1248 / 1920,
} as const;

export const TITLE_BOX = { x: 0.13, y: 0.17, width: 0.54, height: 0.08 } as const;
export const LABEL_BOX = { x: 0.13, y: 0.17, width: 0.4, height: 0.05 } as const;
/** Name, guest: the band y 0.56–0.62, still above the safe bottom (0.65). */
export const LOWER_THIRD_BOX = { x: 0.13, y: 0.56, width: 0.54, height: 0.06 } as const;
export const STEP_BOX = { x: 0.13, y: 0.56, width: 0.48, height: 0.06 } as const;
export const CTA_BOX = { x: 0.13, y: 0.46, width: 0.54, height: 0.08 } as const;

export type TextBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const EDGE = 1e-6;

export function boxFitsSafe(box: TextBox): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.x >= SAFE_RECT.left - EDGE &&
    box.y >= SAFE_RECT.top - EDGE &&
    box.x + box.width <= SAFE_RECT.right + EDGE &&
    box.y + box.height <= SAFE_RECT.bottom + EDGE
  );
}

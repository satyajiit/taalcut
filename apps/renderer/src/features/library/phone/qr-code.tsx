// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: designed pairing QR code with Taalcut Avartan center emblem · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · high error correction (30%) with sculpted squircle finder eyes, rounded data modules,
 * and the four-colour Taalcut Avartan mark in a central medallion on a high-contrast white plate so every phone
 * camera reads it in both light and dark modes. */
import { AVARTAN_BEATS, AVARTAN_FOUR_COLOUR_FILLS } from '@taalcut/ui';
import encodeQR from 'qr';
import { useMemo } from 'react';

/**
 * The scan colours: dark modules on a light plate in both themes, because phone cameras decode a QR's dark-on-light
 * and many refuse it inverted. They are the light theme's `raised`, `ink` and `rule` values, held fixed (DESIGN.md,
 * "Colour rules": the pairing QR is the one place a colour doesn't follow the theme), not pure white or black.
 */
const SCAN_PLATE = 'oklch(99.2% 0.004 75)';
const SCAN_INK = 'oklch(21% 0.014 55)';
const SCAN_RULE = 'oklch(87.5% 0.012 70)';
const CENTER_CORE = 'M128 92L139 117L164 128L139 139L128 164L117 139L92 128L117 117Z';

function isFinderModule(x: number, y: number, n: number): boolean {
  const tl = x >= 2 && x < 9 && y >= 2 && y < 9;
  const tr = x >= n - 9 && x < n - 2 && y >= 2 && y < 9;
  const bl = x >= 2 && x < 9 && y >= n - 9 && y < n - 2;
  return tl || tr || bl;
}

function FinderEye({ x, y, accent = false }: { x: number; y: number; accent?: boolean }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0.5} y={0.5} width={6} height={6} rx={1.75} fill="none" stroke={SCAN_INK} strokeWidth={1} />
      <rect
        x={2}
        y={2}
        width={3}
        height={3}
        rx={0.85}
        className={accent ? 'fill-logo-1' : undefined}
        fill={accent ? undefined : SCAN_INK}
      />
    </g>
  );
}

/**
 * Designed studio QR code with sculpted squircle finder patterns, rounded data
 * dots, and the Taalcut 4-beat Avartan logo centered inside a clear medallion.
 */
export function QrCode({ text, label, size = 224 }: { text: string; label: string; size?: number }) {
  const { dots, modules, logoBox } = useMemo(() => {
    const matrix = encodeQR(text, 'raw', { ecc: 'high', border: 2 });
    const n = matrix.length;
    const center = n / 2;
    const clearHalf = Math.max(4.2, n * 0.115);
    const list: [number, number][] = [];
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (!dark) return;
        if (isFinderModule(x, y, n)) return;
        if (Math.abs(x + 0.5 - center) <= clearHalf && Math.abs(y + 0.5 - center) <= clearHalf) return;
        list.push([x, y]);
      }),
    );
    const boxSize = clearHalf * 1.9;
    return {
      dots: list,
      modules: n,
      logoBox: {
        x: center - boxSize / 2,
        y: center - boxSize / 2,
        size: boxSize,
      },
    };
  }, [text]);

  const iconPad = logoBox.size * 0.13;
  const iconSize = logoBox.size - iconPad * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      data-slot="qr-code"
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="geometricPrecision"
      className="block rounded-xl shadow-xs"
      style={{ background: SCAN_PLATE }}
    >
      <g fill={SCAN_INK}>
        {dots.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x + 0.07} y={y + 0.07} width={0.86} height={0.86} rx={0.34} />
        ))}
      </g>

      <FinderEye x={2} y={2} />
      <FinderEye x={modules - 9} y={2} accent />
      <FinderEye x={2} y={modules - 9} />

      <g data-slot="qr-logo">
        <rect
          x={logoBox.x}
          y={logoBox.y}
          width={logoBox.size}
          height={logoBox.size}
          rx={logoBox.size * 0.28}
          fill={SCAN_PLATE}
          stroke={SCAN_RULE}
          strokeWidth={0.35}
        />
        <svg
          x={logoBox.x + iconPad}
          y={logoBox.y + iconPad}
          width={iconSize}
          height={iconSize}
          viewBox="14 14 228 228"
          aria-hidden
        >
          {AVARTAN_BEATS.light.map((d, i) => (
            <path key={d} className={AVARTAN_FOUR_COLOUR_FILLS[i]} fillRule="evenodd" d={d} />
          ))}
          <path d={CENTER_CORE} fill={SCAN_INK} />
        </svg>
      </g>
    </svg>
  );
}

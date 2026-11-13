// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: dither-field · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · interactive dot-matrix canvas field and 2x2 pixel status mark for in-flight image
 *   generation (modeled after beui.dev/r/image-generation) · states: active (wave + pointer attraction) · static
 *   (reduced-motion or error) · complete (Check) · error (CircleAlert) */

import { Check, CircleAlert } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '#lib/cn';

export type ImageGenerationStatus = 'queued' | 'generating' | 'refining' | 'complete' | 'error';

const CLOCKWISE_ORDER = [0, 1, 3, 2] as const;

export interface DitherMarkProps {
  status: ImageGenerationStatus;
  className?: string;
}

/**
 * 2x2 rotating pixel mark while an image is being generated, switching to a
 * check mark on completion or an alert mark on error.
 */
export function DitherMark({ status, className }: DitherMarkProps) {
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const active = status === 'queued' || status === 'generating' || status === 'refining';

  useEffect(() => {
    if (!active || reducedMotion) return;
    const id = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 160);
    return () => clearInterval(id);
  }, [active, reducedMotion]);

  if (status === 'complete') {
    return <Check aria-hidden className={cn('size-3.5 shrink-0 text-good', className)} strokeWidth={2} />;
  }
  if (status === 'error') {
    return (
      <CircleAlert aria-hidden className={cn('size-3.5 shrink-0 text-danger', className)} strokeWidth={1.75} />
    );
  }

  const activeIdx = CLOCKWISE_ORDER[step];
  const prevIdx = CLOCKWISE_ORDER[(step + 3) % 4];

  return (
    <span
      aria-hidden
      className={cn('inline-grid size-3.5 shrink-0 grid-cols-2 place-items-center gap-[2px] p-[2px]', className)}
    >
      {[0, 1, 2, 3].map((idx) => {
        const opacity = reducedMotion ? 0.65 : idx === activeIdx ? 1 : idx === prevIdx ? 0.55 : 0.2;
        return (
          <span
            key={idx}
            className="size-[3px] rounded-[0.5px] bg-current transition-opacity duration-(--dur-micro)"
            style={{ opacity }}
          />
        );
      })}
    </span>
  );
}

export interface DitherFieldProps {
  active: boolean;
  className?: string;
}

/**
 * Interactive dot-matrix canvas field that breathes while an image is being
 * generated and responds subtly to pointer proximity. Reads `--color-ink` via
 * computed text color at draw time and stops animating under `prefers-reduced-motion`.
 */
export function DitherField({ active, className }: DitherFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: -9999, y: -9999, tx: -9999, ty: -9999 });
  const rafRef = useRef<number>(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let dotColor = getComputedStyle(canvas).color || 'currentColor';

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dotColor = getComputedStyle(canvas).color || 'currentColor';
    };

    resize();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(canvas);

    const start = performance.now();
    const step = 11;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      const p = pointerRef.current;
      p.x += (p.tx - p.x) * 0.14;
      p.y += (p.ty - p.y) * 0.14;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = dotColor;

      const cols = Math.ceil(width / step);
      const rows = Math.ceil(height / step);
      const ox = (width - (cols - 1) * step) / 2;
      const oy = (height - (rows - 1) * step) / 2;

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const bx = ox + c * step;
          const by = oy + r * step;

          const dx = bx - p.x;
          const dy = by - p.y;
          const dist = Math.hypot(dx, dy);
          const prox = Math.max(0, 1 - dist / 110);
          const pull = prox * prox * 3.5;
          const angle = Math.atan2(dy, dx);
          const x = bx - Math.cos(angle) * pull;
          const y = by - Math.sin(angle) * pull;

          const wave =
            Math.sin(c * 0.42 + t * 1.9) * Math.cos(r * 0.42 - t * 1.4) * 0.5 +
            Math.sin((c + r) * 0.28 - t * 2.3) * 0.5;
          const norm = (wave + 1) * 0.5;

          const radius = 0.75 + norm * 0.85 + prox * 1.15;
          const alpha = Math.min(0.75, 0.08 + norm * 0.24 + prox * 0.45);

          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      if (active && !reducedMotion) {
        rafRef.current = requestAnimationFrame(render);
      }
    };

    if (active && !reducedMotion) {
      rafRef.current = requestAnimationFrame(render);
    } else {
      render(performance.now());
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
    };
  }, [active, reducedMotion]);

  const onMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current.tx = event.clientX - rect.left;
    pointerRef.current.ty = event.clientY - rect.top;
  }, []);

  const onLeave = useCallback(() => {
    pointerRef.current.tx = -9999;
    pointerRef.current.ty = -9999;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn('size-full text-ink', className)}
    />
  );
}

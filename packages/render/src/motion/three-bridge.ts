// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic GSAP ↔ Three.js 3D WebGL scene bridge for HyperFrames compositions (WP-HFW-3D-CDP).
 *
 * Three.js scenes never run their own `requestAnimationFrame` loop inside Taalcut's render bundle.
 * Instead, GSAP tweens mutate a plain numeric state proxy on `window.__timelines[compositionId]`,
 * and every `hf-seek` frame steps the timeline and invokes `renderer.render(scene, camera)`
 * synchronously with `preserveDrawingBuffer: true` and a seeded `mulberry32` PRNG.
 */
import { z } from 'zod';
import { err, ok, ValidationError, type Result } from '@taalcut/core';

export const threeVector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const threeCameraSpecSchema = z.object({
  fov: z.number().min(10).max(120).default(45),
  near: z.number().positive().default(0.1),
  far: z.number().positive().default(1000),
  position: threeVector3Schema.default([0, 0, 5]),
  lookAt: threeVector3Schema.default([0, 0, 0]),
});

export const threeLightSpecSchema = z.object({
  kind: z.enum(['ambient', 'directional', 'point']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  intensity: z.number().min(0).max(20).default(1),
  position: threeVector3Schema.optional(),
});

export const threeKeyframeSpecSchema = z.object({
  atSeconds: z.number().min(0),
  durationSeconds: z.number().positive(),
  ease: z.string().min(1).default('power2.out'),
  rotation: threeVector3Schema.optional(),
  position: threeVector3Schema.optional(),
  scale: z.number().positive().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

export const threeMeshSpecSchema = z.object({
  id: z.string().min(1).max(64),
  geometry: z.enum(['box', 'plane', 'sphere', 'torus', 'cylinder']),
  size: threeVector3Schema.default([1, 1, 1]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  metalness: z.number().min(0).max(1).default(0.2),
  roughness: z.number().min(0).max(1).default(0.35),
  wireframe: z.boolean().default(false),
  position: threeVector3Schema.default([0, 0, 0]),
  rotation: threeVector3Schema.default([0, 0, 0]),
  scale: z.number().positive().default(1),
  keyframes: z.array(threeKeyframeSpecSchema).max(32).default([]),
});

export const threeSceneSpecSchema = z.object({
  id: z.string().min(1).max(64),
  compositionId: z.string().min(1).max(64),
  seed: z.number().int().min(0).max(0xffffffff).default(0x5441414c),
  width: z.number().int().min(64).max(3840).default(1080),
  height: z.number().int().min(64).max(3840).default(1920),
  durationSeconds: z.number().positive().max(180),
  camera: threeCameraSpecSchema.default({
    fov: 45,
    near: 0.1,
    far: 1000,
    position: [0, 0, 5],
    lookAt: [0, 0, 0],
  }),
  lights: z.array(threeLightSpecSchema).max(8).default([]),
  meshes: z.array(threeMeshSpecSchema).min(1).max(32),
});

export type ThreeCameraSpec = z.infer<typeof threeCameraSpecSchema>;
export type ThreeLightSpec = z.infer<typeof threeLightSpecSchema>;
export type ThreeKeyframeSpec = z.infer<typeof threeKeyframeSpecSchema>;
export type ThreeMeshSpec = z.infer<typeof threeMeshSpecSchema>;
export type ThreeSceneSpec = z.infer<typeof threeSceneSpecSchema>;

/** Deterministic Mulberry32 PRNG matching the in-page Three.js scene seed. */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function validateThreeSceneSpec(input: unknown): Result<ThreeSceneSpec> {
  const parsed = threeSceneSpecSchema.safeParse(input);
  if (!parsed.success) {
    return err(ValidationError({ field: 'threeSceneSpec' }, { detail: parsed.error.message.slice(0, 500) }));
  }
  const spec = parsed.data;
  for (const mesh of spec.meshes) {
    for (const kf of mesh.keyframes) {
      if (kf.atSeconds + kf.durationSeconds > spec.durationSeconds + 1e-6) {
        return err(
          ValidationError(
            { field: 'keyframes' },
            {
              detail: `mesh "${mesh.id}" keyframe [${kf.atSeconds}s + ${kf.durationSeconds}s] exceeds scene duration ${spec.durationSeconds}s`,
            },
          ),
        );
      }
    }
  }
  return ok(spec);
}

/** Builds the deterministic `<canvas data-tc-three>` markup and embedded JSON scene specification. */
export function buildThreeCanvasHtml(spec: ThreeSceneSpec): string {
  const safeJson = JSON.stringify(spec).replace(/</g, '\\u003c');
  return [
    `<canvas data-tc-three="${spec.id}" data-composition-id="${spec.compositionId}" width="${spec.width}" height="${spec.height}" style="width:100%;height:100%;display:block;pointer-events:none"></canvas>`,
    `<script type="application/json" data-tc-three-spec="${spec.id}">${safeJson}</script>`,
  ].join('\n');
}

/**
 * In-page deterministic GSAP ↔ Three.js runtime bridge:
 * - Never calls `requestAnimationFrame`
 * - Uses `preserveDrawingBuffer: true` for deterministic headless-shell frame capture
 * - Syncs mesh transforms to `window.__timelines[spec.compositionId]` and `hf-seek` events.
 */
export const TC_THREE_RUNTIME_JS = `(() => {
  window.__tcThreeErrors = window.__tcThreeErrors || [];
  window.__tcThreeCreateRng = function(seed) {
    let s = seed >>> 0;
    return function() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  window.__tcThreeBindScene = function(canvas, spec, THREE) {
    if (!canvas || !spec) return null;
    canvas.addEventListener('webglcontextlost', function(ev) {
      ev.preventDefault();
      window.__tcThreeErrors.push('WebGL context lost on ' + spec.id);
    });
    const proxies = {};
    for (const m of spec.meshes || []) {
      proxies[m.id] = {
        px: m.position[0], py: m.position[1], pz: m.position[2],
        rx: m.rotation[0], ry: m.rotation[1], rz: m.rotation[2],
        scale: m.scale, opacity: 1
      };
    }
    let renderNow = function() {};
    if (THREE && typeof THREE.WebGLRenderer === 'function') {
      try {
        const renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance'
        });
        renderer.setSize(spec.width, spec.height, false);
        const scene = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(spec.camera.fov, spec.width / spec.height, spec.camera.near, spec.camera.far);
        cam.position.set(spec.camera.position[0], spec.camera.position[1], spec.camera.position[2]);
        cam.lookAt(spec.camera.lookAt[0], spec.camera.lookAt[1], spec.camera.lookAt[2]);
        const lights = spec.lights && spec.lights.length > 0
          ? spec.lights
          : [
              { type: 'ambient', color: '#ffffff', intensity: 0.6 },
              { type: 'directional', color: '#ffffff', intensity: 1.2, position: [4, 6, 8] }
            ];
        for (const l of lights) {
          if (l.type === 'ambient' && typeof THREE.AmbientLight === 'function') {
            scene.add(new THREE.AmbientLight(l.color, l.intensity));
          } else if (l.type === 'point' && typeof THREE.PointLight === 'function') {
            const pt = new THREE.PointLight(l.color, l.intensity);
            if (l.position && pt.position) pt.position.set(l.position[0], l.position[1], l.position[2]);
            scene.add(pt);
          } else if (typeof THREE.DirectionalLight === 'function') {
            const dir = new THREE.DirectionalLight(l.color, l.intensity);
            if (l.position && dir.position) dir.position.set(l.position[0], l.position[1], l.position[2]);
            scene.add(dir);
          }
        }
        const meshNodes = {};
        for (const m of spec.meshes || []) {
          const geo = m.geometry === 'sphere'
            ? new THREE.SphereGeometry(m.size[0] * 0.5, 32, 32)
            : m.geometry === 'plane'
              ? new THREE.PlaneGeometry(m.size[0], m.size[1])
              : m.geometry === 'torus' && typeof THREE.TorusGeometry === 'function'
                ? new THREE.TorusGeometry(m.size[0] * 0.5, m.size[1] * 0.2, 16, 48)
                : m.geometry === 'cylinder' && typeof THREE.CylinderGeometry === 'function'
                  ? new THREE.CylinderGeometry(m.size[0] * 0.5, m.size[0] * 0.5, m.size[1], 32)
                  : new THREE.BoxGeometry(m.size[0], m.size[1], m.size[2]);
          const mat = new THREE.MeshStandardMaterial({
            color: m.color, metalness: m.metalness, roughness: m.roughness,
            wireframe: Boolean(m.wireframe), transparent: true, opacity: 1
          });
          const node = new THREE.Mesh(geo, mat);
          scene.add(node);
          meshNodes[m.id] = node;
        }
        renderNow = function() {
          for (const m of spec.meshes || []) {
            const p = proxies[m.id];
            const node = meshNodes[m.id];
            if (!p || !node) continue;
            node.position.set(p.px, p.py, p.pz);
            node.rotation.set(p.rx, p.ry, p.rz);
            node.scale.setScalar(p.scale);
            if (node.material) node.material.opacity = p.opacity;
          }
          renderer.render(scene, cam);
        };
      } catch (err) {
        window.__tcThreeErrors.push(String(err && err.message ? err.message : err));
      }
    }
    if (window.gsap) {
      window.__timelines = window.__timelines || {};
      const tl = window.__timelines[spec.compositionId] || window.gsap.timeline({ paused: true });
      for (const m of spec.meshes || []) {
        const p = proxies[m.id];
        for (const kf of m.keyframes || []) {
          const vars = { duration: kf.durationSeconds, ease: kf.ease || 'power2.out', onUpdate: renderNow };
          if (kf.position) { vars.px = kf.position[0]; vars.py = kf.position[1]; vars.pz = kf.position[2]; }
          if (kf.rotation) { vars.rx = kf.rotation[0]; vars.ry = kf.rotation[1]; vars.rz = kf.rotation[2]; }
          if (typeof kf.scale === 'number') vars.scale = kf.scale;
          if (typeof kf.opacity === 'number') vars.opacity = kf.opacity;
          tl.to(p, vars, kf.atSeconds);
        }
      }
      window.__timelines[spec.compositionId] = tl;
    }
    window.addEventListener('hf-seek', renderNow);
    renderNow();
    return { proxies: proxies, render: renderNow };
  };
})()`;

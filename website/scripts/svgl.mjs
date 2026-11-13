// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Brand icons from SVGL (https://svgl.app), written into src/components/brand/svgl/ as React components (WEB2
 * foundation). Run by hand when the set changes; the output is committed and the build never fetches.
 *
 *   node scripts/svgl.mjs
 *
 * For each brand in SET it asks https://api.svgl.app?search=<name>, takes the entry whose title matches, downloads its
 * icon (both drawings where SVGL has a light and a dark one) and writes <id>-icon.tsx (the suffix keeps a provider's
 * name off a bare import path, which the repo's lint reserves for its SDK): the drawing as JSX, its ids made
 * unique per use (useId), anything that could run or reach out refused. registry.tsx maps each id to its drawings;
 * manifest.ts records the SVGL title, the routes, url and brandUrl, and the retrieval date, plus every brand SVGL
 * doesn't have (never drawn by hand). test/unit/svgl-manifest.test.ts holds the three together.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(site, 'src/components/brand/svgl');
const API = 'https://api.svgl.app';
const RETRIEVED = new Date().toISOString().slice(0, 10);
const HEADER = '// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors\n';

/** The brands the site names. `title` is SVGL's own title for the entry. */
const SET = [
  { id: 'openai', search: 'openai', title: 'OpenAI', name: 'OpenAI' },
  { id: 'chatgpt', search: 'chatgpt', title: 'ChatGPT', name: 'ChatGPT', note: 'SVGL has no separate ChatGPT icon: the OpenAI icon stands for it' },
  { id: 'anthropic', search: 'anthropic', title: 'Anthropic', name: 'Anthropic' },
  { id: 'claude', search: 'claude', title: 'Claude AI', name: 'Claude' },
  { id: 'gemini', search: 'gemini', title: 'Gemini', name: 'Gemini' },
  { id: 'openrouter', search: 'openrouter', title: 'OpenRouter', name: 'OpenRouter' },
  { id: 'elevenlabs', search: 'elevenlabs', title: 'ElevenLabs', name: 'ElevenLabs' },
  { id: 'ollama', search: 'ollama', title: 'Ollama', name: 'Ollama' },
  { id: 'lm-studio', search: 'lm studio', title: 'LM Studio', name: 'LM Studio' },
  { id: 'apple', search: 'apple', title: 'Apple', name: 'Apple' },
  { id: 'ubuntu', search: 'ubuntu', title: 'Ubuntu', name: 'Ubuntu' },
  { id: 'windows', search: 'windows', title: 'Windows', name: 'Windows' },
  { id: 'instagram', search: 'instagram', title: 'Instagram', name: 'Instagram' },
  { id: 'github', search: 'github', title: 'GitHub', name: 'GitHub' },
  // Where a reel comes from (the features' sources vignette): Shorts is YouTube's.
  { id: 'youtube', search: 'youtube', title: 'YouTube', name: 'YouTube' },
  { id: 'tiktok', search: 'tiktok', title: 'TikTok', name: 'TikTok' },
  // WEB3: the plugins and other agents (Codex beside Claude), and the import page's cameras and the posting plugin.
  { id: 'codex', search: 'codex', title: 'Codex', name: 'Codex' },
  { id: 'postiz', search: 'postiz', title: 'Postiz', name: 'Postiz' },
  { id: 'dji', search: 'dji', title: 'DJI', name: 'DJI' },
  { id: 'insta360', search: 'insta360', title: 'Insta360', name: 'Insta360' },
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: 'application/json, image/svg+xml' } });
  if (!res.ok && res.status !== 404) throw new Error(`${url}: HTTP ${res.status}`);
  return { ok: res.ok, text: await res.text() };
}

// ---------- a small, strict SVG reader ----------

const REFUSED_ELEMENTS = /^(script|foreignobject|style|image|iframe|a|animate\w*|set)$/i;
const DROPPED_ELEMENTS = /^(title|desc|metadata)$/i;
const ROOT_DROPPED = new Set(['width', 'height', 'xmlns', 'xmlns:xlink', 'xml:space', 'style', 'class', 'id', 'version', 'x', 'y', 'preserveAspectRatio']);

/** Parses SVG markup into { name, attrs: [[k, v]], children } nodes. Throws on anything it doesn't understand. */
function parseSvg(source) {
  const text = source.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root = { name: '#root', attrs: [], children: [] };
  const stack = [root];
  const tag = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let at = 0;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    const between = text.slice(at, m.index);
    const top = stack.at(-1);
    if (between.trim() && !DROPPED_ELEMENTS.test(top.name)) throw new Error(`Text inside <${top.name}>: ${between.trim().slice(0, 40)}`);
    at = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      if (stack.pop().name !== name) throw new Error(`Mismatched </${name}>`);
      continue;
    }
    const attrs = [...rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, k, a, b]) => [k, a ?? b]);
    const node = { name, attrs, children: [] };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('Unclosed element');
  const svg = root.children.find((n) => n.name === 'svg');
  if (!svg) throw new Error('No <svg>');
  return svg;
}

/** What a drawing's <style> may set on its parts: colour and paint, nothing that loads or runs. */
const STYLE_PROPS = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'clip-rule']);
const STYLE_VALUE = /^(#[0-9a-f]{3,8}|[a-z]+|[\d.]+%?)$/i;

/**
 * A drawing that colours its parts through a <style> of class rules (TikTok's): each rule becomes the attributes of the
 * elements that carry its class, and the <style> goes, so the drawing needs no stylesheet and stays unchanged. Only
 * plain `.class { property: value }` rules with paint properties are taken; anything else is refused.
 */
function inlineClassStyles(source, url) {
  const rules = new Map();
  const without = source.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    let rest = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [whole, name, decls] of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      rest = rest.replace(whole, '');
      const list = rules.get(name) ?? [];
      for (const decl of decls.split(';').map((d) => d.trim()).filter(Boolean)) {
        const [k, ...v] = decl.split(':');
        const prop = k.trim().toLowerCase();
        const value = v.join(':').trim();
        if (!STYLE_PROPS.has(prop) || !STYLE_VALUE.test(value)) throw new Error(`${url}: refused style "${decl}"`);
        list.push([prop, value]);
      }
      rules.set(name, list);
    }
    if (rest.trim()) throw new Error(`${url}: refused style "${rest.trim().slice(0, 40)}"`);
    return '';
  });
  if (rules.size === 0) return without;
  return without.replace(/<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g, (whole, name, attrs, self) => {
    const cls = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
    if (!cls) return whole;
    let out = attrs.replace(cls[0], '');
    for (const c of (cls[1] ?? cls[2]).split(/\s+/).filter(Boolean)) {
      for (const [prop, value] of rules.get(c) ?? []) {
        out = out.replace(new RegExp(`\\s${prop}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
        out += ` ${prop}="${value}"`;
      }
    }
    return `<${name}${out}${self ? ' /' : ''}>`;
  });
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** The attribute's JSX name: camelCase for presentation attributes, href for xlink:href. */
function jsxName(name) {
  if (name === 'class') return 'className';
  if (name === 'xlink:href') return 'href';
  if (/^(data|aria)-/.test(name)) return name;
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function styleObject(css) {
  const entries = css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [k, ...v] = d.split(':');
      return [k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.join(':').trim()];
    });
  return `{{ ${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }}`;
}

/** The drawing as JSX, with its ids made per-use and every reference to them rewritten. */
function toJsx(svg, source) {
  const ids = new Set();
  walk(svg, (n) => {
    if (REFUSED_ELEMENTS.test(n.name)) throw new Error(`${source}: refused <${n.name}>`);
    for (const [k, v] of n.attrs) {
      if (/^on/i.test(k)) throw new Error(`${source}: refused ${k}`);
      if (/href$/i.test(k) && !v.startsWith('#')) throw new Error(`${source}: refused ${k}="${v}"`);
      if (k === 'id') ids.add(v);
    }
  });
  const usesIds = ids.size > 0;
  const ref = (v) => {
    let out = v;
    let dynamic = false;
    out = out.replace(/url\(#([^)]+)\)/g, (whole, id) => {
      if (!ids.has(id)) return '';
      dynamic = true;
      return `url(#\${uid}-${id})`;
    });
    return { value: out.trim(), dynamic };
  };

  const attrsOf = (node, isRoot) => {
    const out = [];
    for (const [k, v] of node.attrs) {
      if (isRoot && ROOT_DROPPED.has(k)) continue;
      if (k.startsWith('xmlns') || k === 'xml:space') continue;
      const name = jsxName(k);
      if (k === 'style') {
        out.push(`${name}=${styleObject(v)}`);
      } else if (k === 'id') {
        out.push(`id={\`\${uid}-${v}\`}`);
      } else if (/href$/i.test(k)) {
        const id = v.slice(1);
        if (!ids.has(id)) throw new Error(`${source}: ${k} to a missing #${id}`);
        out.push(`${name}={\`#\${uid}-${id}\`}`);
      } else if (v.includes('url(#')) {
        const r = ref(v);
        if (!r.value) continue; // a reference to nothing (an export left it behind): drawn without it, as browsers do
        out.push(r.dynamic ? `${name}={\`${r.value}\`}` : `${name}=${JSON.stringify(r.value)}`);
      } else {
        out.push(`${name}=${JSON.stringify(v)}`);
      }
    }
    return out;
  };

  const lines = [];
  const emit = (node, depth, isRoot) => {
    if (DROPPED_ELEMENTS.test(node.name)) return;
    const pad = '  '.repeat(depth);
    const attrs = attrsOf(node, isRoot);
    if (isRoot) attrs.push('{...props}');
    const open = `${pad}<${node.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    const kids = node.children.filter((c) => !DROPPED_ELEMENTS.test(c.name));
    if (kids.length === 0) {
      lines.push(`${open} />`);
      return;
    }
    lines.push(`${open}>`);
    for (const child of kids) emit(child, depth + 1, false);
    lines.push(`${pad}</${node.name}>`);
  };

  const viewBox = svg.attrs.find(([k]) => k === 'viewBox')?.[1];
  if (!viewBox) {
    const w = svg.attrs.find(([k]) => k === 'width')?.[1];
    const h = svg.attrs.find(([k]) => k === 'height')?.[1];
    if (!w || !h) throw new Error(`${source}: no viewBox and no size`);
    svg.attrs.push(['viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`]);
  }
  emit(svg, 2, true);
  return { jsx: lines.join('\n'), usesIds, viewBox: svg.attrs.find(([k]) => k === 'viewBox')[1] };
}

// ---------- write ----------

const pascal = (id) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

function componentSource(entry, drawings) {
  const parts = drawings.map(({ variant, url, jsx, usesIds }) => {
    const fn = `${pascal(entry.id)}${variant === 'default' ? '' : pascal(variant)}`;
    const body = usesIds
      ? `  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');\n  return (\n${jsx}\n  );`
      : `  return (\n${jsx}\n  );`;
    return { fn, variant, src: `/** ${entry.title}, ${variant === 'default' ? 'one drawing for both themes' : `for a ${variant} background`}: ${url} */\nexport function ${fn}(props: SVGProps<SVGSVGElement>) {\n${body}\n}\n` };
  });
  const hooks = drawings.some((d) => d.usesIds);
  const imports = hooks ? `import { useId, type SVGProps } from 'react';` : `import type { SVGProps } from 'react';`;
  const owner = entry.brandUrl ? ` Its owner's brand page: ${entry.brandUrl}.` : '';
  return {
    parts,
    text:
      `${HEADER}// Generated by scripts/svgl.mjs from SVGL (https://svgl.app), "${entry.title}", retrieved ${RETRIEVED}. Don't edit: run\n` +
      `// \`node scripts/svgl.mjs\`. The drawing is ${entry.name}'s own mark, shown unchanged beside its name.${owner}\n` +
      `${imports}\n\n${parts.map((p) => p.src).join('\n')}`,
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const found = [];
const missing = [];
for (const brand of SET) {
  const { ok, text } = await fetchText(`${API}?search=${encodeURIComponent(brand.search)}`);
  const list = ok ? JSON.parse(text) : [];
  const entry = Array.isArray(list) ? list.find((e) => e.title.trim().toLowerCase() === brand.title.toLowerCase()) : undefined;
  if (!entry) {
    missing.push({ id: brand.id, name: brand.name, search: brand.search, retrieved: RETRIEVED, note: brand.note ?? 'Not on SVGL: shown as its name in words, never a drawing of our own' });
    console.log(`missing  ${brand.id} (searched "${brand.search}")`);
    continue;
  }
  const routes = typeof entry.route === 'string' ? { default: entry.route } : { light: entry.route.light, dark: entry.route.dark };
  const drawings = [];
  for (const [variant, url] of Object.entries(routes)) {
    const svg = await fetchText(url);
    if (!svg.ok) throw new Error(`${url}: not found`);
    drawings.push({ variant, url, ...toJsx(parseSvg(inlineClassStyles(svg.text, url)), url) });
  }
  const meta = { id: brand.id, name: brand.name, title: entry.title, svglId: entry.id, category: entry.category, routes, url: entry.url, ...(entry.brandUrl ? { brandUrl: entry.brandUrl } : {}), retrieved: RETRIEVED };
  const { text: tsx, parts } = componentSource(meta, drawings);
  writeFileSync(join(OUT, `${brand.id}-icon.tsx`), tsx);
  found.push({ meta, parts, viewBox: drawings[0].viewBox });
  console.log(`wrote    ${brand.id} (${drawings.map((d) => d.variant).join(', ')})`);
}

const idUnion = found.map((f) => `'${f.meta.id}'`).join(' | ');
writeFileSync(
  join(OUT, 'manifest.ts'),
  `${HEADER}// Generated by scripts/svgl.mjs. Don't edit: run \`node scripts/svgl.mjs\`.\n\n` +
    `/** A brand icon the site shows, as SVGL lists it: its title, the drawings' addresses and the brand's own pages. */\n` +
    `export interface SvglEntry {\n  readonly id: BrandIconId;\n  /** The brand's name, as the site writes it beside the icon. */\n  readonly name: string;\n  /** SVGL's own title and id for the entry. */\n  readonly title: string;\n  readonly svglId: number;\n  readonly category: string | readonly string[];\n` +
    `  /** The SVG files, one for both themes (default) or one for each background. */\n  readonly routes: { readonly default?: string; readonly light?: string; readonly dark?: string };\n  readonly url: string;\n  readonly brandUrl?: string;\n  /** ISO date the files were taken. */\n  readonly retrieved: string;\n}\n\n` +
    `/** A brand the site names that SVGL doesn't have: its name in words, never a drawing of our own. */\nexport interface SvglMissing {\n  readonly id: string;\n  readonly name: string;\n  readonly search: string;\n  readonly retrieved: string;\n  readonly note: string;\n}\n\n` +
    `export type BrandIconId = ${idUnion};\n\n` +
    `export const SVGL: readonly SvglEntry[] = ${JSON.stringify(found.map((f) => f.meta), null, 2)};\n\n` +
    `export const SVGL_MISSING: readonly SvglMissing[] = ${JSON.stringify(missing, null, 2)};\n`,
);

const imports = found.map((f) => `import { ${f.parts.map((p) => p.fn).join(', ')} } from './${f.meta.id}-icon';`).join('\n');
const rows = found
  .map((f) => {
    const by = Object.fromEntries(f.parts.map((p) => [p.variant, p.fn]));
    return `  '${f.meta.id}': { light: ${by.light ?? by.default}${by.dark ? `, dark: ${by.dark}` : ''}, viewBox: '${f.viewBox}' },`;
  })
  .join('\n');
writeFileSync(
  join(OUT, 'registry.tsx'),
  `${HEADER}// Generated by scripts/svgl.mjs. Don't edit: run \`node scripts/svgl.mjs\`.\n` +
    `import type { ComponentType, SVGProps } from 'react';\nimport type { BrandIconId } from './manifest';\n${imports}\n\n` +
    `/** Each brand's drawings: \`light\` for a light background (or the one drawing), \`dark\` for a dark one where SVGL has it. */\n` +
    `export interface BrandDrawings {\n  readonly light: ComponentType<SVGProps<SVGSVGElement>>;\n  readonly dark?: ComponentType<SVGProps<SVGSVGElement>>;\n  readonly viewBox: string;\n}\n\n` +
    `export const BRAND_DRAWINGS: Readonly<Record<BrandIconId, BrandDrawings>> = {\n${rows}\n};\n`,
);

console.log(`${found.length} icons, ${missing.length} missing (${missing.map((m) => m.id).join(', ') || 'none'}), into ${OUT}: ${readdirSync(OUT).length} files`);

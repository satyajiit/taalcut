// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shape, as core's `hubTemplateV0Schema` has it: schema/hub-template.v0.schema.json (generated from core), plus
 * the few checks core makes that JSON Schema can't state (packages/core/src/hub/hub-parts.ts and the parts it
 * reuses): a rate written reduced, a text box inside the frame, at most 16 text styles, a name that isn't blank
 * once trimmed. Every one is a `schema` problem, as in core. The index file has its own schema (indexProblems).
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { readRepoJson } from './json-file.mjs';

const MAX_TEXT_STYLES = 16;
/** Rounding slack for x + width and y + height, as core's boxSchema allows. */
const EDGE = 1e-6;

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateTemplate = ajv.compile(readRepoJson('schema', 'hub-template.v0.schema.json'));
const validateIndex = ajv.compile(readRepoJson('schema', 'hub-index.v0.schema.json'));

export function schemaProblems(doc) {
  const problems = validateTemplate(doc) ? [] : ajvProblems(validateTemplate.errors);
  return [...problems, ...refinementProblems(doc)];
}

/** An index the app's `hubIndexSchema` would refuse. */
export function indexProblems(index) {
  return validateIndex(index) ? [] : ajvProblems(validateIndex.errors);
}

function ajvProblems(errors) {
  return (errors ?? []).map((error) => ({ jsonPath: jsonPathOf(error), rule: 'schema' }));
}

function refinementProblems(doc) {
  const problems = [];
  if (!record(doc)) return problems;
  if (typeof doc.name === 'string' && doc.name.trim().length === 0) problems.push({ jsonPath: 'name', rule: 'schema' });
  unreducedRates(doc, [], problems);
  const text = record(doc.structure) && Array.isArray(doc.structure.text) ? doc.structure.text : [];
  text.forEach((overlay, index) => {
    const box = record(overlay) ? overlay.box : null;
    if (record(box) && !(box.x + box.width <= 1 + EDGE && box.y + box.height <= 1 + EDGE)) {
      problems.push({ jsonPath: `structure.text.${index}.box`, rule: 'schema' });
    }
  });
  const styles = record(doc.style) && record(doc.style.textStyles) ? doc.style.textStyles : null;
  if (styles && Object.keys(styles).length > MAX_TEXT_STYLES) problems.push({ jsonPath: 'style.textStyles', rule: 'schema' });
  return problems;
}

/** Every `rate` in the document is a frame rate; core checks it is written in lowest terms (30/1, not 60/2). */
function unreducedRates(value, path, problems) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => unreducedRates(item, [...path, index], problems));
    return;
  }
  if (!record(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const at = [...path, key];
    if (key === 'rate' && record(item) && Number.isSafeInteger(item.num) && Number.isSafeInteger(item.den)) {
      if (item.num > 0 && item.den > 0 && gcd(item.num, item.den) !== 1) problems.push({ jsonPath: at.join('.'), rule: 'schema' });
    } else unreducedRates(item, at, problems);
  }
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function jsonPathOf(error) {
  const base = pointerToDot(error.instancePath);
  const extra = error.params?.additionalProperty;
  if (error.keyword === 'additionalProperties' && typeof extra === 'string') return base ? `${base}.${extra}` : extra;
  return base;
}

function pointerToDot(pointer) {
  if (!pointer) return '';
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

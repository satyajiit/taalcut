// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reference timestamps (P3-V15, SPEC section 23): what the package exports from this folder. */
export { toReferencePointer } from './core-pointer';
export { flowRefs, type FlowRefs } from './flow-refs';
export { LAST } from './lexicon';
export { pointerNote } from './note';
export {
  MAX_REFERENCES,
  parseReferences,
  referenceBasis,
  TYPED_TIME_RATE,
  type ParsedReferences,
  type ReferenceBasis,
  type ReferenceTarget,
  type TimeReference,
} from './parse';
export {
  createPointerResolver,
  type PointerRequest,
  type PointerResolver,
  type PointerSources,
  type StartPointers,
} from './pointers';
export {
  MAX_POINTERS,
  resolveReferences,
  type PointerContext,
  type ResolvedReference,
  type UnresolvedWhy,
} from './resolve';

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: where a docked message goes (SPEC section 38). A message from the editor's chat asks for a change to
 * what is on screen, so it goes to the Editor skill directly, with no planning turn and no make flow. Two kinds go
 * to the planning turn instead: a question ("why is this clip here?"), which the agent answers with the editor in
 * its prompt and no flow to start; and a message whose words ask for a new video ("make a new version", "recast"),
 * the only kind that may start the make flow. In the four v1 languages. Pure.
 */

/** edit: the Editor skill. answer: the planning turn, no flows. make: the planning turn with the make flow. */
export type EditorRoute = 'edit' | 'answer' | 'make';

/** Tool families available to editor turns so workspace, graphics, comments, memory, images and translation stay accessible. */
export const EDITOR_TURN_FAMILIES = [
  'timeline',
  'audio',
  'captions',
  'library',
  'templates',
  'vision',
  'video',
  'music',
  'sfx',
  'voice',
  'render',
  'workspace',
  'graphics',
  'comments',
  'memory',
  'images',
  'translation',
  'plugins',
] as const;

const phrases = (list: string): readonly string[] => list.split('|');

/** Words that ask for a new video, not a change to this one. */
export const MAKE_WORDS = phrases(
  'new version|another version|new variant|another variant|more variants|new video|another video|make a new|make another|recast|re-cast|cast again|start over|start again|from scratch|remake|redo the whole|nueva versión|otra versión|nuevo video|nuevo vídeo|otro video|rehacer todo|desde cero|empezar de nuevo|nova versão|outra versão|novo vídeo|novo video|outro vídeo|refazer tudo|do zero|começar de novo|नया वर्जन|नई वर्जन|नया वीडियो|दूसरा वीडियो|शुरू से|फिर से बनाओ|दोबारा बनाओ',
);

/** A question's first word; "can", "could" and "would" ask for a change, so they aren't here. */
export const QUESTION_STARTS = phrases(
  'what|why|how|which|who|where|when|is|are|does|do|did|was|were|has|have|done|finished|ready|status|qué|que|por qué|cómo|cuál|cuáles|quién|dónde|cuándo|es|está|listo|terminado|o que|por que|como|qual|quais|quem|onde|quando|é|está|pronto|क्या|क्यों|कैसे|कौन|कहाँ|कब|हो गया',
);

/** Words that open a polite edit request ending with a question mark ("Can you trim this?"). */
const EDIT_REQUEST_STARTS = phrases(
  'can|could|would|will|shall|please|trim|cut|swap|drop|delete|remove|move|add|put|make|change|set|speed|slow|shorten|lengthen|replace|insert|split|mute|duck|translate|export|render|puedes|podrías|pode|poderia|कृपया',
);

const START = '(?<![\\p{L}\\p{M}\\p{N}])';
const END = '(?![\\p{L}\\p{M}\\p{N}])';
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words: readonly string[]) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
const MAKE = new RegExp(`${START}(?:${alt(MAKE_WORDS)})${END}`, 'iu');
const QUESTION = new RegExp(`^[¿\\s]*(?:${alt(QUESTION_STARTS)})${END}`, 'iu');
const EDIT_REQUEST = new RegExp(`^[¿\\s]*(?:${alt(EDIT_REQUEST_STARTS)})${END}`, 'iu');
const STATUS_QUESTION =
  /^(?:is\s+it\s+)?(?:done|finished|ready|status|listo|terminado|pronto|हो\s+गया)\s*[?？]*$/iu;

/** Where a message from the editor's chat goes. */
export function editorRoute(message: string): EditorRoute {
  const text = message.trim();
  if (MAKE.test(text)) return 'make';
  if (STATUS_QUESTION.test(text)) return 'answer';
  if (/[?？]\s*$/u.test(text) && (QUESTION.test(text) || !EDIT_REQUEST.test(text))) return 'answer';
  return 'edit';
}

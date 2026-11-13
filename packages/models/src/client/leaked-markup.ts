// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: Qwen's tool-call XML a local server left in the answer's text beside the call it parsed. On the owner's reel
 * the MLX server parsed `readArtifact { id, limit }` and left `</parameter> <parameter=offset> 16384 </parameter>
 * </function>` as text: the call ran without its offset (the same page again) and the chat would show the markup.
 * When a local answer has exactly one call and its text is nothing but such fragments, each parameter in them that
 * the call lacks joins it (JSON when it parses as JSON, else the text) and the text goes. Any other text is left as it
 * is: it may be words the model meant.
 */
import type { AssistantChatMessage } from './messages';

const PARAMETER = /<parameter=([A-Za-z_][\w.-]*)>\s*([\s\S]*?)\s*<\/parameter>/gu;
const TAG = /<\/?(?:tool_call|function(?:=[^>\s]*)?|parameter(?:=[^>\s]*)?)>/gu;

const value = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/** The message with leaked parameters joined to its one call, or the message as it was. */
export function mendLeakedMarkup(message: AssistantChatMessage): AssistantChatMessage {
  const texts = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
  const calls = message.parts.filter((part) => part.type === 'tool_call');
  const text = texts.join('');
  if (calls.length !== 1 || !/<\/?(?:parameter|function|tool_call)\b/u.test(text)) return message;
  if (text.replace(PARAMETER, '').replace(TAG, '').trim() !== '') return message;
  const call = calls[0]!;
  if (call.type !== 'tool_call') return message;
  const leaked = Object.fromEntries(
    [...text.matchAll(PARAMETER)]
      .filter(([, name]) => !(name! in call.call.arguments))
      .map(([, name, raw]) => [name!, value(raw!)]),
  );
  const joined = { ...call, call: { ...call.call, arguments: { ...call.call.arguments, ...leaked } } };
  return {
    ...message,
    parts: message.parts.flatMap((part) => (part.type === 'text' ? [] : part === call ? [joined] : [part])),
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A cloud vision provider that never touches the network: a real
 * @taalcut/models ModelClient whose `fetch` is a recording stub answering in
 * OpenAI's Chat Completions stream format. Every request body is kept, so a
 * test can say exactly what left the device and when.
 */
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  type FetchFn,
} from '@taalcut/models';

export const CLOUD_VISION = { provider: 'cloud-vision', model: 'eyes-1' } as const;

export interface SentRequest {
  readonly url: string;
  readonly body: string;
}

const frame = (delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: 1_760_000_000,
    model: CLOUD_VISION.model,
    choices: finish === 'usage' ? [] : [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  })}\n\n`;

/** The SSE body of one streamed Chat Completions answer. */
function answer(text: string): string {
  return [
    frame({ role: 'assistant', content: '' }),
    frame({ content: text }),
    frame({}, 'stop'),
    frame({}, 'usage', { prompt_tokens: 900, completion_tokens: 12, total_tokens: 912 }),
    'data: [DONE]\n\n',
  ].join('');
}

async function bodyOf(input: Parameters<FetchFn>[0], init: Parameters<FetchFn>[1]): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) return input.clone().text();
  if (init?.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  return init?.body ? String(init.body) : '';
}

/** A vision model on this Mac, served over loopback (P3-B10's Local only tests). */
export const LOCAL_VISION = { provider: 'mac-vision', model: 'eyes-local' } as const;

/**
 * A vision ModelClient on a cloud provider, and what it sent. `localOnly` is read on every call. `onDevice`
 * adds a model on this Mac after the cloud one, as the built-in profiles' fallbacks run the other way round.
 */
export function recordingVisionClient(
  options: { readonly localOnly?: () => boolean; readonly onDevice?: boolean } = {},
) {
  const sent: SentRequest[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    sent.push({ url, body: await bodyOf(input, init) });
    return new Response(answer('A beach at sunrise.'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const runtime = createModelRuntime({
    endpoints: [
      {
        id: CLOUD_VISION.provider,
        name: 'Cloud vision',
        baseUrl: 'https://vision.example.test/v1',
        // A hosted server: not this Mac, whatever its address looks like.
        local: false,
        models: [{ id: CLOUD_VISION.model, vision: true }],
      },
      ...(options.onDevice
        ? [
            {
              id: LOCAL_VISION.provider,
              name: 'Vision on this Mac',
              baseUrl: 'http://127.0.0.1:8090/v1',
              local: true,
              models: [{ id: LOCAL_VISION.model, vision: true }],
            },
          ]
        : []),
    ],
  });
  const choices = options.onDevice ? [CLOUD_VISION, LOCAL_VISION] : [CLOUD_VISION];
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider({
      [CLOUD_VISION.provider]: { kind: 'api_key', secret: 'vision-test-key-0123456789', source: 'test' },
    }),
    callLog,
    selector: { resolve: (module) => ({ ok: true, value: { module, choices } }) },
    fetch,
    retry: { maxRetries: 0 },
    ...(options.localOnly ? { localOnly: options.localOnly } : {}),
  });
  return { client, sent, callLog, runtime };
}

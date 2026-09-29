import { AppException } from '../../../common/exceptions/app.exception';
import { AnthropicAdapter } from './anthropic.adapter';
import { FetchFn, parseSseEvent } from './base.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { MockAdapter } from './mock.adapter';
import { OpenAiAdapter } from './openai.adapter';

const encoder = new TextEncoder();

/** A text/event-stream Response; `hang` keeps it open after the chunks. */
function sse(chunks: string[], hang = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (!hang) {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const config = (timeoutMs = 1000) => ({
  apiKey: 'test-key-1234',
  model: 'm',
  timeoutMs,
});
const turns = [{ role: 'user' as const, content: 'Hi' }];

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const pieces: string[] = [];
  for await (const piece of stream) {
    pieces.push(piece);
  }
  return pieces;
}

async function failure(stream: AsyncIterable<string>): Promise<AppException> {
  try {
    await collect(stream);
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected the stream to fail');
}

describe('parseSseEvent', () => {
  it('reads event and multi-line data', () => {
    expect(parseSseEvent('event: delta\ndata: a\ndata: b')).toEqual({
      event: 'delta',
      data: 'a\nb',
    });
    expect(parseSseEvent('data: x')).toEqual({ event: 'message', data: 'x' });
    expect(parseSseEvent(': keep-alive comment')).toBeNull();
  });
});

describe('streaming adapters (CH-5)', () => {
  it('OpenAI: yields delta content until [DONE], even across chunk borders', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(
        sse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi',
          'ces":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const pieces = await collect(
      new OpenAiAdapter(config(), fetchFn).chatStream(turns),
    );
    expect(pieces).toEqual(['Hel', 'lo']);
    expect(JSON.parse(fetchFn.mock.calls[0][1]?.body as string).stream).toBe(
      true,
    );
  });

  it('Anthropic: yields text deltas and maps an error event to 502', async () => {
    const ok = await collect(
      new AnthropicAdapter(config(), () =>
        Promise.resolve(
          sse([
            'event: message_start\ndata: {"type":"message_start"}\n\n',
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi "}}\n\n',
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"there"}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ]),
        ),
      ).chatStream(turns),
    );
    expect(ok).toEqual(['Hi ', 'there']);

    const error = await failure(
      new AnthropicAdapter(config(), () =>
        Promise.resolve(
          sse(['event: error\ndata: {"type":"overloaded_error"}\n\n']),
        ),
      ).chatStream(turns),
    );
    expect([error.getStatus(), error.code]).toEqual([502, 'PROVIDER_ERROR']);
  });

  it('Gemini: uses streamGenerateContent with alt=sse', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(
        sse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Bon"}]}}]}\r\n\r\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"jour"}]}}]}\r\n\r\n',
        ]),
      ),
    );
    const pieces = await collect(
      new GeminiAdapter(config(), fetchFn).chatStream(turns),
    );
    expect(pieces).toEqual(['Bon', 'jour']);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
    );
  });

  it('maps an HTTP error to 502 before any piece', async () => {
    const error = await failure(
      new OpenAiAdapter(config(), () =>
        Promise.resolve(new Response('{}', { status: 500 })),
      ).chatStream(turns),
    );
    expect([error.getStatus(), error.code]).toEqual([502, 'PROVIDER_ERROR']);
  });

  it('a stalled stream fails with 504 after the idle timeout', async () => {
    const pieces: string[] = [];
    const adapter = new OpenAiAdapter(config(50), () =>
      Promise.resolve(
        sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'], true),
      ),
    );
    let caught: unknown;
    try {
      for await (const piece of adapter.chatStream(turns)) {
        pieces.push(piece);
      }
    } catch (error) {
      caught = error;
    }
    expect(pieces).toEqual(['partial']);
    expect((caught as AppException).code).toBe('PROVIDER_TIMEOUT');
    expect((caught as AppException).getStatus()).toBe(504);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const adapter = new OpenAiAdapter(config(), () =>
      Promise.resolve(
        sse(['data: {"choices":[{"delta":{"content":"one"}}]}\n\n'], true),
      ),
    );
    const iterator = adapter.chatStream(turns, controller.signal);
    const pieces: string[] = [];
    let caught: unknown;
    try {
      for await (const piece of iterator) {
        pieces.push(piece);
        controller.abort();
      }
    } catch (error) {
      caught = error;
    }
    expect(pieces).toEqual(['one']);
    expect((caught as Error).name).toBe('AbortError');
  });

  it('Mock: streams the chat() answer word by word, fails mid-stream on [mock-error]', async () => {
    const mock = new MockAdapter(config());
    const pieces = await collect(mock.chatStream(turns));
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.join('')).toBe((await mock.chat(turns)).content);

    const partial: string[] = [];
    let caught: unknown;
    try {
      for await (const piece of mock.chatStream([
        { role: 'user', content: 'x [mock-error]' },
      ])) {
        partial.push(piece);
      }
    } catch (error) {
      caught = error;
    }
    expect(partial).toHaveLength(2);
    expect((caught as AppException).code).toBe('PROVIDER_ERROR');
  });
});

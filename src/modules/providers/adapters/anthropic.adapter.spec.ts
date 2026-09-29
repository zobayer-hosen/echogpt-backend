import { AppException } from '../../../common/exceptions/app.exception';
import { AnthropicAdapter } from './anthropic.adapter';
import { FetchFn } from './base.adapter';

const KEY = 'sk-ant-test-c3d4';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const hanging: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () =>
      reject(init.signal?.reason as Error),
    ),
  );
const make = (fetchFn: FetchFn, timeoutMs = 1000) =>
  new AnthropicAdapter(
    { apiKey: KEY, model: 'claude-haiku-4-5', timeoutMs },
    fetchFn,
  );
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error as AppException,
  );

describe('AnthropicAdapter (T11)', () => {
  it('calls the Messages API with x-api-key and joins text blocks', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(
        json(200, {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'there' },
          ],
        }),
      ),
    );
    const result = await make(fetchFn).chat([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hey' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(result.content).toBe('Hello there');

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: expect.any(String),
    });
    expect(body.messages).toHaveLength(3);
  });

  it('maps HTTP errors to 502 and timeouts to 504', async () => {
    const http = await failure(
      make(() => Promise.resolve(json(529, {}))).chat([
        { role: 'user', content: 'Hi' },
      ]),
    );
    expect([http.getStatus(), http.code]).toEqual([502, 'PROVIDER_ERROR']);
    expect(JSON.stringify(http.getResponse())).not.toContain(KEY);

    const slow = await failure(
      make(hanging, 20).chat([{ role: 'user', content: 'Hi' }]),
    );
    expect([slow.getStatus(), slow.code]).toEqual([504, 'PROVIDER_TIMEOUT']);
  });

  it('falls back to the raw text when search output is not JSON', async () => {
    const result = await make(() =>
      Promise.resolve(
        json(200, { content: [{ type: 'text', text: 'Plain answer.' }] }),
      ),
    ).search('anything');
    expect(result).toMatchObject({ answer: 'Plain answer.', results: [] });
  });
});

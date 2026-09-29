import { AppException } from '../../../common/exceptions/app.exception';
import { FetchFn } from './base.adapter';
import { GeminiAdapter } from './gemini.adapter';

const KEY = 'AIza-test-e5f6';
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
  new GeminiAdapter(
    { apiKey: KEY, model: 'gemini-flash-latest', timeoutMs },
    fetchFn,
  );
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error as AppException,
  );

describe('GeminiAdapter (T11)', () => {
  it('sends the key in a header (never the URL) and maps roles', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(
        json(200, {
          candidates: [{ content: { parts: [{ text: 'Bonjour' }] } }],
        }),
      ),
    );
    const result = await make(fetchFn).chat([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'In French?' },
    ]);
    expect(result.content).toBe('Bonjour');

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    );
    expect(url as string).not.toContain(KEY);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      KEY,
    );
    const body = JSON.parse(init?.body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual([
      'user',
      'model',
      'user',
    ]);
  });

  it('maps HTTP errors to 502 and timeouts to 504', async () => {
    const http = await failure(
      make(() => Promise.resolve(json(403, {}))).search('x'),
    );
    expect([http.getStatus(), http.code]).toEqual([502, 'PROVIDER_ERROR']);

    const slow = await failure(make(hanging, 20).search('x'));
    expect([slow.getStatus(), slow.code]).toEqual([504, 'PROVIDER_TIMEOUT']);
  });
});

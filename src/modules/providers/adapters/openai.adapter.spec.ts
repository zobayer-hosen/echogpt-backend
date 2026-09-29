import { AppException } from '../../../common/exceptions/app.exception';
import { FetchFn } from './base.adapter';
import { OpenAiAdapter } from './openai.adapter';

const KEY = 'sk-test-secret-a1b2';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
/** never answers; rejects when the adapter's timeout signal fires */
const hanging: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () =>
      reject(init.signal?.reason as Error),
    ),
  );

const make = (fetchFn: FetchFn, timeoutMs = 1000) =>
  new OpenAiAdapter({ apiKey: KEY, model: 'gpt-4o-mini', timeoutMs }, fetchFn);

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error as AppException,
  );

describe('OpenAiAdapter (T11)', () => {
  it('sends the chat request with a bearer key and reads the answer', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(
        json(200, { choices: [{ message: { content: 'Hello!' } }] }),
      ),
    );
    const result = await make(fetchFn).chat([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('Hello!');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('parses search JSON into answer + results', async () => {
    const content = JSON.stringify({
      answer: 'NestJS is a Node.js framework.',
      results: [
        { title: 'NestJS', url: 'https://nestjs.com', snippet: 'Docs' },
        { title: 'Bad', url: 'javascript:alert(1)', snippet: 'dropped' },
      ],
    });
    const result = await make(() =>
      Promise.resolve(json(200, { choices: [{ message: { content } }] })),
    ).search('what is nestjs');
    expect(result.answer).toBe('NestJS is a Node.js framework.');
    expect(result.results).toEqual([
      { title: 'NestJS', url: 'https://nestjs.com', snippet: 'Docs' },
    ]);
  });

  it.each([400, 401, 429, 500, 503])(
    'maps HTTP %i to 502 PROVIDER_ERROR without leaking the key',
    async (status) => {
      const error = await failure(
        make(() =>
          Promise.resolve(
            json(status, { error: { message: `Incorrect API key ${KEY}` } }),
          ),
        ).chat([{ role: 'user', content: 'Hi' }]),
      );
      expect(error).toBeInstanceOf(AppException);
      expect(error.getStatus()).toBe(502);
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(JSON.stringify(error.getResponse())).not.toContain(KEY);
    },
  );

  it('maps a timeout to 504 PROVIDER_TIMEOUT', async () => {
    const error = await failure(
      make(hanging, 20).chat([{ role: 'user', content: 'Hi' }]),
    );
    expect(error.getStatus()).toBe(504);
    expect(error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('maps a network failure to 502 PROVIDER_ERROR', async () => {
    const error = await failure(
      make(() => Promise.reject(new TypeError('fetch failed'))).chat([
        { role: 'user', content: 'Hi' },
      ]),
    );
    expect(error.getStatus()).toBe(502);
    expect(error.code).toBe('PROVIDER_ERROR');
  });

  it('maps an empty answer to 502', async () => {
    const error = await failure(
      make(() => Promise.resolve(json(200, { choices: [] }))).chat([
        { role: 'user', content: 'Hi' },
      ]),
    );
    expect(error.code).toBe('PROVIDER_ERROR');
  });

  it('health check reads the model and reports UP / DOWN', async () => {
    const up = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(json(200, { id: 'gpt-4o-mini' })),
    );
    expect(await make(up).healthCheck()).toMatchObject({ ok: true });
    expect(up.mock.calls[0][0]).toBe(
      'https://api.openai.com/v1/models/gpt-4o-mini',
    );

    const down = await make(() => Promise.resolve(json(401, {}))).healthCheck();
    expect(down).toMatchObject({
      ok: false,
      error: 'OpenAI returned HTTP 401',
    });
  });

  it('without a key the health check is DOWN and nothing is sent', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
    const adapter = new OpenAiAdapter(
      { apiKey: null, model: 'gpt-4o-mini', timeoutMs: 1000 },
      fetchFn,
    );
    expect(await adapter.healthCheck()).toMatchObject({
      ok: false,
      error: 'OpenAI has no API key configured',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

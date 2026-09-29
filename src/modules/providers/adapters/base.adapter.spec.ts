import { parseSearchAnswer } from './base.adapter';
import {
  MOCK_ERROR_MARKER,
  MOCK_TIMEOUT_MARKER,
  MockAdapter,
} from './mock.adapter';

describe('parseSearchAnswer', () => {
  it('reads JSON wrapped in a code fence', () => {
    const text =
      '```json\n{"answer":"Yes.","results":[{"title":"A","url":"https://a.dev","snippet":"s"}]}\n```';
    expect(parseSearchAnswer(text)).toEqual({
      answer: 'Yes.',
      results: [{ title: 'A', url: 'https://a.dev', snippet: 's' }],
    });
  });

  it('keeps only http(s) results and caps them at 8', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      title: `T${i}`,
      url: i === 0 ? 'ftp://x' : `https://site.dev/${i}`,
      snippet: 's',
    }));
    const parsed = parseSearchAnswer(JSON.stringify({ answer: 'a', results }));
    expect(parsed.results).toHaveLength(8);
    expect(parsed.results[0].url).toBe('https://site.dev/1');
  });

  it('falls back to plain text', () => {
    expect(parseSearchAnswer('  no json here ')).toEqual({
      answer: 'no json here',
      results: [],
    });
  });
});

describe('MockAdapter', () => {
  const mock = new MockAdapter({
    apiKey: null,
    model: 'mock-1',
    timeoutMs: 1000,
  });

  it('answers chat deterministically and sees history', async () => {
    const result = await mock.chat([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ]);
    expect(result.content).toContain('"second"');
    expect(result.content).toContain('2 earlier message(s)');
  });

  it('returns 3 search results', async () => {
    const result = await mock.search('Nest JS');
    expect(result.results).toHaveLength(3);
    expect(result.results[0].url).toBe('https://example.com/nest-js/1');
  });

  it('simulates provider errors and timeouts on request', async () => {
    await expect(
      mock.chat([{ role: 'user', content: `boom ${MOCK_ERROR_MARKER}` }]),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(
      mock.search(`slow ${MOCK_TIMEOUT_MARKER}`),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('is always healthy', async () => {
    expect(await mock.healthCheck()).toMatchObject({ ok: true });
  });
});

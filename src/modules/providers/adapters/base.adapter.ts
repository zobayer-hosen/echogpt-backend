import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/constants/error-codes';
import { AppException } from '../../../common/exceptions/app.exception';
import type { SearchResultItem } from '../../search/entities/web-search.entity';
import {
  AdapterConfig,
  AiProviderAdapter,
  ChatResult,
  ChatTurn,
  HealthResult,
  SearchResult,
} from './ai-provider-adapter.interface';

export type FetchFn = typeof fetch;

export const CHAT_SYSTEM_PROMPT =
  'You are EchoGPT, a helpful assistant inside a browser side panel. Answer clearly and concisely.';

export const SEARCH_SYSTEM_PROMPT = [
  'You are a web search assistant.',
  'Answer the query in 2-4 sentences and list up to 5 relevant web pages.',
  'Reply with JSON only, no markdown:',
  '{"answer": string, "results": [{"title": string, "url": string, "snippet": string}]}',
].join(' ');

const MAX_RESULTS = 8;

/**
 * Shared plumbing for HTTP adapters: fetch with a timeout, error mapping,
 * and the search-over-chat prompt. Subclasses only speak their provider's API.
 */
export abstract class BaseAdapter implements AiProviderAdapter {
  protected abstract readonly label: string;

  constructor(
    protected readonly config: AdapterConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  /** Provider-specific completion call. */
  protected abstract complete(
    messages: ChatTurn[],
    system: string,
  ): Promise<string>;

  /** Provider-specific cheap call that proves key and model work. */
  protected abstract ping(): Promise<void>;

  async chat(messages: ChatTurn[]): Promise<ChatResult> {
    const started = Date.now();
    const content = await this.complete(messages, CHAT_SYSTEM_PROMPT);
    return { content, latencyMs: Date.now() - started };
  }

  async search(query: string): Promise<SearchResult> {
    const started = Date.now();
    const text = await this.complete(
      [{ role: 'user', content: query }],
      SEARCH_SYSTEM_PROMPT,
    );
    return { ...parseSearchAnswer(text), latencyMs: Date.now() - started };
  }

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.ping();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  protected requireKey(): string {
    if (!this.config.apiKey) {
      throw new AppException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PROVIDER_ERROR,
        `${this.label} has no API key configured`,
      );
    }
    return this.config.apiKey;
  }

  /**
   * fetch + JSON with the configured timeout. Maps failures to
   * 504 PROVIDER_TIMEOUT or 502 PROVIDER_ERROR. Provider response bodies
   * are not echoed, since some include parts of the key.
   */
  protected async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.send(url, init);
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw this.mapFetchError(error, 'returned an invalid response');
    }
  }

  protected async send(url: string, init: RequestInit): Promise<Response> {
    const doFetch = this.fetchFn;
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw this.mapFetchError(error, 'could not be reached');
    }
    if (!response.ok) {
      throw new AppException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PROVIDER_ERROR,
        `${this.label} returned HTTP ${response.status}`,
        { provider: this.label, providerStatus: response.status },
      );
    }
    return response;
  }

  protected emptyAnswer(): AppException {
    return new AppException(
      HttpStatus.BAD_GATEWAY,
      ErrorCode.PROVIDER_ERROR,
      `${this.label} returned an empty answer`,
      { provider: this.label },
    );
  }

  private mapFetchError(error: unknown, what: string): AppException {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new AppException(
        HttpStatus.GATEWAY_TIMEOUT,
        ErrorCode.PROVIDER_TIMEOUT,
        `${this.label} did not answer within ${Math.round(this.config.timeoutMs / 1000)}s`,
        { provider: this.label },
      );
    }
    return new AppException(
      HttpStatus.BAD_GATEWAY,
      ErrorCode.PROVIDER_ERROR,
      `${this.label} ${what}`,
      { provider: this.label },
    );
  }
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Reads the JSON the search prompt asks for. Tolerates code fences and
 * text around the JSON; falls back to the raw text as the answer.
 */
export function parseSearchAnswer(text: string): {
  answer: string;
  results: SearchResultItem[];
} {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        answer?: unknown;
        results?: unknown;
      };
      if (typeof parsed.answer === 'string') {
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        return {
          answer: parsed.answer.trim(),
          results: results
            .filter(
              (r): r is SearchResultItem =>
                typeof r === 'object' &&
                r !== null &&
                typeof (r as SearchResultItem).title === 'string' &&
                isHttpUrl((r as SearchResultItem).url),
            )
            .slice(0, MAX_RESULTS)
            .map((r) => ({
              title: r.title.slice(0, 300),
              url: r.url,
              snippet:
                typeof r.snippet === 'string' ? r.snippet.slice(0, 1000) : '',
            })),
        };
      }
    } catch {
      // not JSON; use the text as is
    }
  }
  return { answer: text.trim(), results: [] };
}

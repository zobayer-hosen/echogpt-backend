import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/constants/error-codes';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  AdapterConfig,
  AiProviderAdapter,
  ChatResult,
  ChatTurn,
  HealthResult,
  SearchResult,
} from './ai-provider-adapter.interface';

/** Put these markers in a prompt or query to simulate provider failures. */
export const MOCK_ERROR_MARKER = '[mock-error]';
export const MOCK_TIMEOUT_MARKER = '[mock-timeout]';

/** Pause between streamed words, so streaming is visible in a client. */
const STREAM_DELAY_MS = 15;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free, offline provider (PRD A1): deterministic answers, no key, no network.
 * Seeded as the default so the whole API works out of the box.
 */
export class MockAdapter implements AiProviderAdapter {
  constructor(private readonly config: AdapterConfig) {}

  chat(messages: ChatTurn[]): Promise<ChatResult> {
    const started = Date.now();
    const failure = this.simulatedFailure(lastPrompt(messages));
    if (failure) {
      return Promise.reject(failure);
    }
    return Promise.resolve({
      content: this.reply(messages),
      latencyMs: Date.now() - started,
    });
  }

  /** Streams the chat() answer word by word; `[mock-error]` fails after 2 words. */
  async *chatStream(
    messages: ChatTurn[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const prompt = lastPrompt(messages);
    const failure = this.simulatedFailure(prompt);
    if (failure && prompt.includes(MOCK_TIMEOUT_MARKER)) {
      throw failure;
    }
    const words = this.reply(messages).split(/(?<= )/);
    for (const [index, word] of words.entries()) {
      if (failure && index === 2) {
        throw failure;
      }
      await pause(STREAM_DELAY_MS);
      if (signal?.aborted) {
        throw new DOMException('The caller aborted the stream', 'AbortError');
      }
      yield word;
    }
  }

  search(query: string): Promise<SearchResult> {
    const started = Date.now();
    const failure = this.simulatedFailure(query);
    if (failure) {
      return Promise.reject(failure);
    }
    const slug = encodeURIComponent(
      query.trim().toLowerCase().replace(/\s+/g, '-'),
    );
    return Promise.resolve({
      answer: `Mock answer for "${query}". This is simulated search output from the Mock provider.`,
      results: [1, 2, 3].map((n) => ({
        title: `${query} - result ${n}`,
        url: `https://example.com/${slug}/${n}`,
        snippet: `Simulated snippet ${n} about ${query}.`,
      })),
      latencyMs: Date.now() - started,
    });
  }

  healthCheck(): Promise<HealthResult> {
    return Promise.resolve({ ok: true, latencyMs: 0 });
  }

  private reply(messages: ChatTurn[]): string {
    const earlier = messages.length - 1;
    return (
      `Mock AI (${this.config.model}) reply to: "${lastPrompt(messages).slice(0, 200)}".` +
      (earlier > 0 ? ` I can see ${earlier} earlier message(s).` : '') +
      ' Add an OpenAI, Anthropic or Gemini key in the admin panel for real answers.'
    );
  }

  /** Failures are returned as rejections, never thrown synchronously. */
  private simulatedFailure(text: string): AppException | null {
    if (text.includes(MOCK_TIMEOUT_MARKER)) {
      return new AppException(
        HttpStatus.GATEWAY_TIMEOUT,
        ErrorCode.PROVIDER_TIMEOUT,
        'Mock did not answer in time (simulated)',
        { provider: 'Mock' },
      );
    }
    if (text.includes(MOCK_ERROR_MARKER)) {
      return new AppException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PROVIDER_ERROR,
        'Mock returned an error (simulated)',
        { provider: 'Mock' },
      );
    }
    return null;
  }
}

function lastPrompt(messages: ChatTurn[]): string {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

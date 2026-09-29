import { ChatTurn } from './ai-provider-adapter.interface';
import { BaseAdapter } from './base.adapter';

const BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

interface ChatCompletionChunk {
  choices?: { delta?: { content?: string | null } }[];
}

/** OpenAI Chat Completions API. */
export class OpenAiAdapter extends BaseAdapter {
  protected readonly label = 'OpenAI';

  protected async complete(
    messages: ChatTurn[],
    system: string,
  ): Promise<string> {
    const body = await this.requestJson<ChatCompletionResponse>(
      `${BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      },
    );
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw this.emptyAnswer();
    }
    return content;
  }

  protected async *streamComplete(
    messages: ChatTurn[],
    system: string,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const events = this.streamEvents(
      `${BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
        }),
      },
      signal,
    );
    for await (const event of events) {
      if (event.data === '[DONE]') {
        return;
      }
      const chunk = this.parseJson<ChatCompletionChunk>(event.data);
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) {
        yield text;
      }
    }
  }

  /** Reads the model; free, and fails on a bad key or unknown model. */
  protected async ping(): Promise<void> {
    await this.send(
      `${BASE_URL}/models/${encodeURIComponent(this.config.model)}`,
      { method: 'GET', headers: this.headers() },
    );
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.requireKey()}`,
      'Content-Type': 'application/json',
    };
  }
}

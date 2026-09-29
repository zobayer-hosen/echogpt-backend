import { ChatTurn } from './ai-provider-adapter.interface';
import { BaseAdapter } from './base.adapter';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

interface MessagesResponse {
  content?: { type: string; text?: string }[];
}

/** Anthropic Messages API (Claude). */
export class AnthropicAdapter extends BaseAdapter {
  protected readonly label = 'Anthropic';

  protected async complete(
    messages: ChatTurn[],
    system: string,
  ): Promise<string> {
    const body = await this.requestJson<MessagesResponse>(
      `${BASE_URL}/messages`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: MAX_TOKENS,
          system,
          messages,
        }),
      },
    );
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('');
    if (!text) {
      throw this.emptyAnswer();
    }
    return text;
  }

  /** Reads the model; fails on a bad key or unknown model. */
  protected async ping(): Promise<void> {
    await this.send(
      `${BASE_URL}/models/${encodeURIComponent(this.config.model)}`,
      { method: 'GET', headers: this.headers() },
    );
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.requireKey(),
      'anthropic-version': API_VERSION,
      'Content-Type': 'application/json',
    };
  }
}

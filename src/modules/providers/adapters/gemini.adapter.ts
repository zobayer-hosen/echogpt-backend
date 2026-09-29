import { ChatTurn } from './ai-provider-adapter.interface';
import { BaseAdapter } from './base.adapter';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Google Gemini generateContent API. The key goes in a header, never the URL. */
export class GeminiAdapter extends BaseAdapter {
  protected readonly label = 'Gemini';

  protected async complete(
    messages: ChatTurn[],
    system: string,
  ): Promise<string> {
    const body = await this.requestJson<GenerateContentResponse>(
      `${this.modelUrl()}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(messages, system)),
      },
    );
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
    if (!text) {
      throw this.emptyAnswer();
    }
    return text;
  }

  protected async *streamComplete(
    messages: ChatTurn[],
    system: string,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const events = this.streamEvents(
      `${this.modelUrl()}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(messages, system)),
      },
      signal,
    );
    for await (const event of events) {
      const chunk = this.parseJson<GenerateContentResponse>(event.data);
      const text = (chunk.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      if (text) {
        yield text;
      }
    }
  }

  /** Reads the model; fails on a bad key or unknown model. */
  protected async ping(): Promise<void> {
    await this.send(this.modelUrl(), {
      method: 'GET',
      headers: this.headers(),
    });
  }

  private body(messages: ChatTurn[], system: string) {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };
  }

  private modelUrl(): string {
    return `${BASE_URL}/models/${encodeURIComponent(this.config.model)}`;
  }

  private headers(): Record<string, string> {
    return {
      'x-goog-api-key': this.requireKey(),
      'Content-Type': 'application/json',
    };
  }
}

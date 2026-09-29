import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderType } from '../../../common/enums/provider-type.enum';
import { AppConfig } from '../../../config/configuration';
import {
  AdapterConfig,
  AiProviderAdapter,
} from './ai-provider-adapter.interface';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { MockAdapter } from './mock.adapter';
import { OpenAiAdapter } from './openai.adapter';

/** Picks the adapter class from `provider.type`. */
@Injectable()
export class AdapterFactory {
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.timeoutMs = config.get('ai.requestTimeoutMs', { infer: true });
  }

  create(
    provider: { type: ProviderType; model: string },
    apiKey: string | null,
  ): AiProviderAdapter {
    const config: AdapterConfig = {
      apiKey,
      model: provider.model,
      timeoutMs: this.timeoutMs,
    };
    switch (provider.type) {
      case ProviderType.OPENAI:
        return new OpenAiAdapter(config);
      case ProviderType.ANTHROPIC:
        return new AnthropicAdapter(config);
      case ProviderType.GEMINI:
        return new GeminiAdapter(config);
      case ProviderType.MOCK:
        return new MockAdapter(config);
    }
  }
}

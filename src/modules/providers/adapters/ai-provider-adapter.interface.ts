import type { SearchResultItem } from '../../search/entities/web-search.entity';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  latencyMs: number;
}

export interface SearchResult {
  answer: string;
  results: SearchResultItem[];
  latencyMs: number;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  /** short reason when not ok; never contains the API key */
  error?: string;
}

export interface AdapterConfig {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

/**
 * One interface for every AI provider (PRD §5.4). A new provider is one new
 * class implementing this. Errors are thrown as AppException
 * (502 PROVIDER_ERROR / 504 PROVIDER_TIMEOUT).
 */
export interface AiProviderAdapter {
  /** Answer the last user turn, using the earlier turns as context. */
  chat(messages: ChatTurn[]): Promise<ChatResult>;

  /** AI-assisted web search: short answer + list of {title, url, snippet}. */
  search(query: string): Promise<SearchResult>;

  /** Tiny real call to check key and model; never throws. */
  healthCheck(): Promise<HealthResult>;
}

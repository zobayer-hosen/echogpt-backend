import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import { UsageFeature } from '../enums/usage-feature.enum';

/** Info about the AI call made while serving a request (for api_usage_logs). */
export interface AiCallInfo {
  feature: UsageFeature;
  providerId: string | null;
  success: boolean;
}

export interface RequestStore {
  requestId: string;
  startedAt: number;
  method: string;
  /** path without the query string */
  path: string;
  ip: string | null;
  ai?: AiCallInfo;
}

export interface RequestUser {
  id: string;
}

/** Express request with the fields this app adds. */
export type AppRequest = Request & {
  requestId?: string;
  user?: RequestUser;
};

const storage = new AsyncLocalStorage<RequestStore>();

/** Per-request context, available anywhere down the async call chain. */
export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestStore | undefined {
    return storage.getStore();
  },

  /** Services call this after an AI call; the request logger saves it. */
  setAiCall(info: AiCallInfo): void {
    const store = storage.getStore();
    if (store) {
      store.ai = info;
    }
  },
};

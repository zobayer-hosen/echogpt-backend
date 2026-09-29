/** `••••a1b2` from the last 4 characters of a key; null when there is no key. */
export function maskKey(last4: string | null | undefined): string | null {
  return last4 ? `••••${last4}` : null;
}

/** Last 4 characters of a secret, the only part ever stored in clear. */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}

/** Trims and collapses all whitespace runs to one space. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Conversation title: first 60 characters of the first prompt (ERD §3). */
export function conversationTitle(prompt: string): string {
  return collapseWhitespace(prompt).slice(0, 60) || 'New chat';
}

/** Search cache/suggestion key: lowercase, trimmed, single spaces. */
export function normalizeQuery(query: string): string {
  return collapseWhitespace(query).toLowerCase();
}

/** `••••a1b2` from the last 4 characters of a key; null when there is no key. */
export function maskKey(last4: string | null | undefined): string | null {
  return last4 ? `••••${last4}` : null;
}

/** Last 4 characters of a secret, the only part ever stored in clear. */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}

import {
  conversationTitle,
  lastFour,
  maskKey,
  normalizeQuery,
} from './text.util';

describe('text.util', () => {
  it('masks keys to the last 4 characters', () => {
    expect(maskKey(lastFour('sk-live-abcdef1234'))).toBe('••••1234');
    expect(maskKey(null)).toBeNull();
  });

  it('normalizes search queries', () => {
    expect(normalizeQuery('  What IS   NestJS?\n')).toBe('what is nestjs?');
  });

  it('titles a conversation with the first 60 characters of the prompt', () => {
    expect(conversationTitle('  hello\n\nworld ')).toBe('hello world');
    expect(conversationTitle('x'.repeat(100))).toHaveLength(60);
    expect(conversationTitle('   ')).toBe('New chat');
  });
});

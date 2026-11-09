import { describe, it, expect } from 'vitest';
import { ApiErrorCodes } from '@soba/lib';
import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';

// The pages show these by the server's error code, so each language needs one for every code.
describe('API error messages', () => {
  it.each([
    ['en', en.apiErrors],
    ['fr', fr.apiErrors],
  ])('%s has a message for every error code', (_language, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.values(ApiErrorCodes).sort());
    expect(Object.values(messages).every((text) => text.trim().length > 0)).toBe(true);
  });
});

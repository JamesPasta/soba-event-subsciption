import type { Request } from 'express';
import { getToken } from '../../../src/core/auth/IdpPlugin';

const req = (headers: Record<string, string>, query: Record<string, string> = {}) =>
  ({ headers, query }) as unknown as Request;

describe('getToken', () => {
  it.each([
    ['abc', 'a bearer', req({ authorization: 'Bearer abc' })],
    ['abc', 'a lower-case scheme', req({ authorization: 'bearer abc' })],
    [null, 'no header', req({})],
    [null, 'an empty bearer', req({ authorization: 'Bearer ' })],
    [null, 'another scheme', req({ authorization: 'Basic abc' })],
    [null, 'extra parts', req({ authorization: 'Bearer abc def' })],
    [null, 'an X-Jwt-Token header', req({ 'x-jwt-token': 'abc' })],
    [null, 'a token query parameter', req({}, { token: 'abc' })],
    [null, 'an x-jwt-token query parameter', req({}, { 'x-jwt-token': 'abc' })],
  ])('returns %p for %s', (expected, _label, request) => {
    expect(getToken(request)).toBe(expected);
  });
});

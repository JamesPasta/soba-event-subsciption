import { describe, it, expect } from 'vitest';
import {
  addAddresses,
  addressesOf,
  splitAddresses,
  withAddresses,
} from '@/src/features/post-submission/actions/email/addresses';

describe('splitAddresses', () => {
  it('splits a typed or pasted list on commas, semicolons and spaces', () => {
    expect(splitAddresses(' a@example.com, b@example.com;c@example.com  d@example.com ')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ]);
  });

  it('keeps only the addresses from a list with names, as Outlook copies it', () => {
    expect(
      splitAddresses('"Smith, Jane" <jane@gov.bc.ca>; "Doe, John" <john@gov.bc.ca>; ann@gov.bc.ca'),
    ).toEqual(['jane@gov.bc.ca', 'john@gov.bc.ca', 'ann@gov.bc.ca']);
  });

  it('keeps an entry with no name beside named ones, and a comma inside a quoted name', () => {
    expect(splitAddresses('Jane <jane@gov.bc.ca>, bob.gov.bc.ca')).toEqual([
      'jane@gov.bc.ca',
      'bob.gov.bc.ca',
    ]);
    expect(splitAddresses('"Smith, Jane" <jane@gov.bc.ca>\n"Doe, John" <john@gov.bc.ca>')).toEqual([
      'jane@gov.bc.ca',
      'john@gov.bc.ca',
    ]);
  });

  it('keeps text that holds no address, so the field can say what is wrong', () => {
    expect(splitAddresses('jane')).toEqual(['jane']);
    expect(splitAddresses('  ')).toEqual([]);
  });
});

describe('addAddresses', () => {
  it('adds valid addresses lower-cased, once each', () => {
    expect(
      addAddresses(['a@example.com'], ['B@Example.com', 'A@example.com', 'b@example.com']),
    ).toEqual({
      list: ['a@example.com', 'b@example.com'],
      added: ['b@example.com'],
      duplicates: ['a@example.com', 'b@example.com'],
      invalid: [],
      overflow: [],
    });
  });

  it('returns what is not an address to stay in the field', () => {
    const result = addAddresses([], ['jane', 'ok@example.com', 'bob@']);
    expect(result.list).toEqual(['ok@example.com']);
    expect(result.invalid).toEqual(['jane', 'bob@']);
  });

  it('stops at the limit and returns the rest', () => {
    const result = addAddresses(['a@example.com'], ['b@example.com', 'c@example.com'], 2);
    expect(result.list).toEqual(['a@example.com', 'b@example.com']);
    expect(result.overflow).toEqual(['c@example.com']);
  });
});

describe('the email options', () => {
  const values = { enabled: false, options: {} };

  it('keeps no options for an empty list', () => {
    expect(withAddresses(values, [])).toEqual({ enabled: false, options: {} });
    expect(withAddresses(values, ['a@example.com'])).toEqual({
      enabled: false,
      options: { to: ['a@example.com'] },
    });
  });

  it('reads no addresses from options that hold none', () => {
    expect(addressesOf(values)).toEqual([]);
    expect(addressesOf({ enabled: true, options: { to: 'a@example.com' } })).toEqual([]);
  });
});

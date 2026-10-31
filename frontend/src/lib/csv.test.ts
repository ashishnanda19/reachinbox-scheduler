import { describe, expect, it } from 'vitest';
import { parseEmails } from './csv';

describe('parseEmails', () => {
  it('reads a CSV with a header and extra columns', () => {
    const csv = 'name,email,company\nAnn,ann@acme.com,Acme\nBob,bob@globex.io,Globex\n';
    expect(parseEmails(csv)).toEqual({ emails: ['ann@acme.com', 'bob@globex.io'], invalid: 0, duplicates: 0 });
  });

  it('reads a plain TXT list, one per line, with Windows line endings', () => {
    expect(parseEmails('a@x.com\r\nb@x.com\r\n\r\nc@x.com').emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('splits on commas, semicolons, tabs, spaces and newlines in one input', () => {
    const text = 'a@x.com, b@x.com;c@x.com\td@x.com e@x.com\nf@x.com';
    expect(parseEmails(text).emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com']);
  });

  it('lowercases and de-duplicates, counting the duplicates', () => {
    expect(parseEmails('A@X.com a@x.com A@x.COM b@x.com')).toEqual({ emails: ['a@x.com', 'b@x.com'], invalid: 0, duplicates: 2 });
  });

  it('counts duplicates against addresses that were already added', () => {
    expect(parseEmails('a@x.com b@x.com', ['a@x.com'])).toEqual({ emails: ['b@x.com'], invalid: 0, duplicates: 1 });
  });

  it('counts invalid addresses but ignores names and headers without @', () => {
    const result = parseEmails('email\nfoo@\n@bar.com\nno-tld@host\nok@x.com\nJohn Smith');
    expect(result.emails).toEqual(['ok@x.com']);
    expect(result.invalid).toBe(3);
  });

  it('strips quotes and angle brackets around addresses', () => {
    expect(parseEmails('"Ann" <ann@acme.com>, (bob@globex.io)').emails).toEqual(['ann@acme.com', 'bob@globex.io']);
  });

  it('accepts plus tags, dots and subdomains', () => {
    expect(parseEmails('first.last+tag@mail.example.co.uk').emails).toEqual(['first.last+tag@mail.example.co.uk']);
  });

  it('returns nothing for empty input', () => {
    expect(parseEmails('')).toEqual({ emails: [], invalid: 0, duplicates: 0 });
  });

  it('handles thousands of rows quickly', () => {
    const text = Array.from({ length: 20000 }, (_, i) => `user${i}@example.com`).join('\n');
    const started = performance.now();
    expect(parseEmails(text).emails).toHaveLength(20000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

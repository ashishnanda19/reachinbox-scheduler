import { describe, expect, it } from 'vitest';
import { htmlToPreview, sanitizeForDisplay } from './html';

describe('htmlToPreview', () => {
  it('flattens blocks and breaks into one line of text', () => {
    expect(htmlToPreview('<p>Hey Oliver,</p><p>You\'ve just <strong>RECEIVED</strong> something<br>new</p>')).toBe(
      "Hey Oliver, You've just RECEIVED something new",
    );
  });

  it('decodes entities and drops tags', () => {
    expect(htmlToPreview('<p>Fish &amp; chips &lt;3</p>')).toBe('Fish & chips <3');
  });

  it('caps the preview at 140 characters', () => {
    expect(htmlToPreview(`<p>${'abc '.repeat(100)}</p>`)).toHaveLength(140);
  });

  it('is empty for an empty body', () => {
    expect(htmlToPreview('<p></p>')).toBe('');
  });
});

describe('sanitizeForDisplay', () => {
  it('removes scripts, handlers and iframes but keeps formatting', () => {
    const clean = sanitizeForDisplay('<p onclick="x()">Hi <strong>you</strong><script>alert(1)</script><iframe src="//evil"></iframe></p>');
    expect(clean).toBe('<p>Hi <strong>you</strong></p>');
  });

  it('blocks javascript: links and keeps https links', () => {
    expect(sanitizeForDisplay('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeForDisplay('<a href="https://example.com">x</a>')).toContain('href="https://example.com"');
  });
});

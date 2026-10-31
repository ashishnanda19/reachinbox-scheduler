import { describe, expect, it } from 'vitest';
import { htmlToText, previewOf, sanitizeEmailHtml } from './html.js';

describe('sanitizeEmailHtml', () => {
  it('keeps the allowed formatting tags', () => {
    const html = '<p>Hi <strong>Bob</strong> <em>and</em> <u>Al</u> <s>x</s></p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote>';
    expect(sanitizeEmailHtml(html)).toBe(html);
  });

  it('removes scripts, event handlers, iframes, images and unknown tags', () => {
    const dirty = '<p onclick="steal()">Hi<script>alert(1)</script><iframe src="https://evil"></iframe><img src=x onerror=alert(1)><h1>Big</h1></p>';
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|iframe|<img|onerror|<h1/);
    expect(clean).toContain('Hi');
  });

  it('allows safe links only', () => {
    expect(sanitizeEmailHtml('<a href="https://example.com" onclick="x()">ok</a>')).toBe('<a href="https://example.com">ok</a>');
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">bad</a>')).not.toContain('javascript:');
    expect(sanitizeEmailHtml('<a href="mailto:a@b.co">mail</a>')).toContain('mailto:a@b.co');
  });

  it('keeps only text-align, font-size, line-height and margin-left in style', () => {
    const html = '<p style="text-align:center;font-size:18px;line-height:1.5;margin-left:24px;color:red;position:fixed;background:url(x)">a</p>';
    const clean = sanitizeEmailHtml(html);
    expect(clean).toContain('text-align:center');
    expect(clean).toContain('font-size:18px');
    expect(clean).toContain('line-height:1.5');
    expect(clean).toContain('margin-left:24px');
    expect(clean).not.toMatch(/color|position|background/);
  });

  it('rejects style values that are not plain sizes or alignments', () => {
    const clean = sanitizeEmailHtml('<span style="font-size:expression(alert(1));text-align:evil">a</span>');
    expect(clean).not.toMatch(/expression|evil/);
  });

  it('drops style on tags that may not carry it', () => {
    expect(sanitizeEmailHtml('<strong style="text-align:center">a</strong>')).toBe('<strong>a</strong>');
  });
});

describe('htmlToText / previewOf', () => {
  it('turns blocks and breaks into lines and decodes entities', () => {
    expect(htmlToText('<p>Hello &amp; welcome</p><p>Line 2<br>Line 3</p>')).toBe('Hello & welcome\nLine 2\nLine 3');
  });

  it('renders list items with bullets', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('• a\n• b');
  });

  it('returns empty text for an empty editor body', () => {
    expect(htmlToText('<p></p>')).toBe('');
  });

  it('builds a one-line preview capped at 140 characters', () => {
    const preview = previewOf(`<p>${'word '.repeat(100)}</p><p>second</p>`);
    expect(preview).toHaveLength(140);
    expect(preview).not.toContain('\n');
    expect(previewOf('<p>Hi <b>there</b></p><p>friend</p>')).toBe('Hi there friend');
  });
});

import sanitizeHtml from 'sanitize-html';

const SIZE = /^\d+(\.\d+)?(px|em|rem|%)$/;

// Email bodies come from a browser editor, so they are sanitized on the server before being stored or sent.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'span'],
  allowedAttributes: { a: ['href'], p: ['style'], span: ['style'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedStyles: {
    p: {
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [SIZE],
      'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/],
      'margin-left': [SIZE],
    },
    span: {
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [SIZE],
      'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/],
      'margin-left': [SIZE],
    },
  },
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&amp;': '&' };

/** Plain-text rendition of an HTML body: used for the text/plain alternative and for list previews. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|li|blockquote|div|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PREVIEW_LENGTH = 140;

/** First 140 characters of the body as one line of plain text. */
export function previewOf(html: string): string {
  return htmlToText(html).replace(/\s+/g, ' ').slice(0, PREVIEW_LENGTH);
}

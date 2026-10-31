import DOMPurify from 'dompurify';

const PREVIEW_LENGTH = 140;

/** Plain-text one-line preview (first 140 characters) of an HTML body. */
export function htmlToPreview(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, ' ').replace(/<\/\s*(p|li|blockquote|div)\s*>/gi, ' ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

/** Email HTML is untrusted: always sanitize before putting it in the DOM. */
export function sanitizeForDisplay(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'span'],
    ALLOWED_ATTR: ['href', 'style', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

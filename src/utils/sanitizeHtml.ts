import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist sanitizer for admin-authored blog HTML (TipTap output). Admins are
 * trusted, but we still strip scripts/handlers/unknown tags so stored content
 * can be rendered with `dangerouslySetInnerHTML` without XSS risk. The tag set
 * mirrors what the rich editor can produce.
 */
export function sanitizeRichHtml(dirty: string): string {
  if (!dirty) return '';
  return sanitizeHtml(dirty, {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'br', 'hr',
      'strong', 'b', 'em', 'i', 'u', 's',
      'ul', 'ol', 'li', 'blockquote',
      'a', 'img', 'code', 'pre', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style'],
    },
    // Only text-align survives from inline styles (used by the align buttons).
    allowedStyles: {
      '*': { 'text-align': [/^(left|right|center|justify)$/] },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: {
      // Force safe rel on every link.
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }, true),
    },
  });
}

/** Strip all HTML to plain text (for deriving an excerpt / meta description). */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short excerpt derived from rich HTML (used when none is provided). */
export function deriveExcerpt(html: string, max = 160): string {
  const text = htmlToPlainText(html);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

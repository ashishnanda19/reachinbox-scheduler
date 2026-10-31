export interface ParsedEmails {
  /** New, valid, lowercased, de-duplicated addresses, in input order. */
  emails: string[];
  /** Tokens that look like an address (contain "@") but are not valid. */
  invalid: number;
  /** Valid addresses skipped because they were already known or repeated in the input. */
  duplicates: number;
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
// Cells and lines can be separated by comma, semicolon, tab, newline or spaces.
const SEPARATORS = /[\s,;]+/;
// Quotes, angle brackets and brackets wrapped around an address ("Name" <a@b.co>).
const WRAPPERS = /^[\s"'<>()[\]]+|[\s"'<>()[\]]+$/g;

/**
 * Pulls every email address out of free text, a CSV or a TXT file. Headers and names (tokens without "@")
 * are ignored silently; tokens with "@" that are not valid addresses are counted as invalid.
 */
export function parseEmails(text: string, existing: Iterable<string> = []): ParsedEmails {
  const seen = new Set<string>(existing);
  const emails: string[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const raw of text.split(SEPARATORS)) {
    const token = raw.replace(WRAPPERS, '');
    if (!token.includes('@')) continue;
    if (!EMAIL.test(token)) {
      invalid += 1;
      continue;
    }
    const email = token.toLowerCase();
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return { emails, invalid, duplicates };
}

export const isValidEmail = (value: string): boolean => EMAIL.test(value);

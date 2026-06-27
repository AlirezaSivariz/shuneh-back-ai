/**
 * Extensible blocklist for discount-code text. Codes are ASCII
 * ([A-Za-z0-9_-]), so Persian-script profanity can never appear — what matters
 * is English + latinized («فینگلیش») Persian profanity. Matching is
 * case-insensitive and strips `_`/`-` so simple evasions (o-f-f) are still
 * caught. Keep this list as the single place to extend.
 */
export const BANNED_WORDS: string[] = [
  // English
  'fuck', 'fuk', 'shit', 'bitch', 'bastard', 'dick', 'cock', 'cunt', 'pussy',
  'porn', 'sex', 'nazi', 'rape', 'slut', 'whore', 'asshole', 'nigger',
  // Latinized Persian («فینگلیش») profanity, common forms
  'kir', 'kos', 'koss', 'kun', 'kuni', 'koni', 'jende', 'jakesh', 'jakosh',
  'kossher', 'koskesh', 'koskhol', 'goh', 'goozo', 'madarjende', 'madarghahbe',
  'pedarsag', 'pedarsg', 'ghahbe', 'ghabe', 'lashi', 'kossomak', 'kosnane',
];

/** Whether the input contains a banned word (case-insensitive, `_-` stripped). */
export function containsBannedWord(input: string): boolean {
  const normalized = input.toLowerCase().replace(/[_-]/g, '');
  return BANNED_WORDS.some((w) => normalized.includes(w));
}

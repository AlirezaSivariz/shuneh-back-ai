/**
 * Persian → Latin transliteration map for stylist usernames.
 * Only characters most likely to appear in Iranian names are included.
 */
const PERSIAN_MAP: Record<string, string> = {
  ' ': '-',
  'أ': 'a', 'ؤ': 'w', 'إ': 'e', 'ئ': 'y',
  'ا': 'a', 'آ': 'a',
  'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's',
  'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
  'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's',
  'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': 'a',
  'غ': 'gh', 'ف': 'f', 'ق': 'gh', 'ک': 'k',
  'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'و': 'v', 'ه': 'h', 'ی': 'y', 'ي': 'y',
  'ء': '', 'ة': 't', '‌': '-',
};

function transliterate(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    out += PERSIAN_MAP[ch] ?? ch;
  }
  return out;
}

/** Regex: valid username characters only. */
const USERNAME_RE = /^[a-z0-9-]+$/;

/** Min and max length for a username. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/**
 * Validate a username format (lowercase, alphanumeric + hyphens, length).
 * Returns null if valid, or an error message string.
 */
export function validateUsernameFormat(username: string): string | null {
  if (username.length < USERNAME_MIN) return `نام کاربری باید حداقل ${USERNAME_MIN} حرف باشد`;
  if (username.length > USERNAME_MAX) return `نام کاربری حداکثر ${USERNAME_MAX} حرف باشد`;
  if (!USERNAME_RE.test(username)) return 'نام کاربری فقط شامل حروف انگلیسی کوچک، عدد و خط تیره باشد';
  if (username.startsWith('-') || username.endsWith('-'))
    return 'نام کاربری نباید با خط تیره شروع یا تمام شود';
  return null;
}

/**
 * Generate a unique username from the user's Persian name + short userId suffix.
 * Format: `{name-part}-{last-4-hex-of-userId}`
 */
export function generateUsername(
  firstName: string | undefined | null,
  lastName: string | undefined | null,
  userId: string,
): string {
  const raw = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  const latin = transliterate(raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const namePart = latin.slice(0, 24) || 'stylist';
  const suffix = userId.replace(/[^a-f0-9]/gi, '').slice(-4);
  return `${namePart}-${suffix}`;
}

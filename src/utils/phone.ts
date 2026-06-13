/**
 * Mask an Iranian mobile number for public display, e.g.
 *   09123456789  ->  0912***6789
 * Keeps the first 4 and last 4 digits, hides the middle.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

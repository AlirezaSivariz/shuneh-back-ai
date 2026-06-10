/**
 * Iranian national code (کد ملی) validation: 10 digits with a check digit.
 */
export function isValidNationalCode(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  // Reject all-identical sequences (e.g. 0000000000) which pass the checksum.
  if (/^(\d)\1{9}$/.test(code)) return false;

  const digits = code.split('').map(Number);
  const check = digits[9];
  const sum = digits
    .slice(0, 9)
    .reduce((acc, digit, index) => acc + digit * (10 - index), 0);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

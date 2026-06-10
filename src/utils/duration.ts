/**
 * Parse a short duration string like "15m", "7d", "300s", "2h" into milliseconds.
 * Supports s (seconds), m (minutes), h (hours), d (days). A bare number is ms.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function durationToMs(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const amount = Number(match[1]);
  const unit = match[2];
  return unit ? amount * UNIT_MS[unit] : amount;
}

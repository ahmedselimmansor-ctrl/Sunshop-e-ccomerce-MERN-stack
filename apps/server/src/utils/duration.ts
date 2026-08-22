/**
 * Parses a human duration (`15m`, `30d`, `2h`) into milliseconds.
 *
 * Hand-rolled rather than pulled from `ms` because token lifetimes are
 * security-relevant configuration: a silent parse failure that yields `NaN`
 * would produce a token with no expiry at all. This throws instead, so a
 * malformed `JWT_ACCESS_TTL` fails at boot rather than at 3am.
 */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}". Expected e.g. "15m", "24h", "30d".`);
  }

  const amount = Number.parseFloat(match[1]!);
  const unit = UNIT_MS[match[2]!.toLowerCase()];

  if (!unit || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid duration "${value}".`);
  }

  return Math.round(amount * unit);
}

export function parseDurationSeconds(value: string): number {
  return Math.floor(parseDuration(value) / 1000);
}

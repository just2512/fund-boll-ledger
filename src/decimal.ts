/** Price arithmetic uses six-decimal fixed-point BigInt values to avoid binary-float drift. */
export const PRICE_SCALE = 1_000_000n;
const MONEY_SCALE = 100n;

export function parseScaled(value: string | number | undefined | null, scale = PRICE_SCALE): bigint {
  let raw = String(value ?? '').trim();
  if (!raw) return 0n;
  if (/e/i.test(raw)) {
    const scientific = Number(raw);
    if (!Number.isFinite(scientific)) throw new Error(`无效数字：${raw}`);
    raw = scientific.toFixed(6);
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Error(`无效数字：${raw}`);
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const decimals = scale.toString().length - 1;
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  let amount = BigInt(whole || '0') * scale + BigInt(padded || '0');
  if (fraction.length > decimals && Number(fraction[decimals]) >= 5) amount += 1n;
  return negative ? -amount : amount;
}

export function formatScaled(value: bigint, decimals = 3): string {
  const places = Math.max(0, Math.min(6, decimals));
  const unit = 10n ** BigInt(6 - places);
  const rounded = value >= 0n ? (value + unit / 2n) / unit : (value - unit / 2n) / unit;
  const absolute = rounded < 0n ? -rounded : rounded;
  const factor = 10n ** BigInt(places);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(places, '0');
  return `${rounded < 0n ? '-' : ''}${whole.toString()}${places ? `.${fraction}` : ''}`;
}

export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('除数必须大于零');
  if (numerator < 0n) return -roundDiv(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

export function roundToTick(value: bigint, tick: bigint): bigint {
  if (tick <= 0n) throw new Error('最小价格变动单位必须大于零');
  return roundDiv(value, tick) * tick;
}

export function priceAmountCents(price: string, quantity: string): bigint {
  const priceMicros = parseScaled(price);
  const qty = parseQuantity(quantity);
  return roundDiv(priceMicros * qty * MONEY_SCALE, PRICE_SCALE);
}

export function parseMoneyCents(value: string | number | undefined | null): bigint {
  const raw = String(value ?? '').trim();
  if (!raw) return 0n;
  return parseScaled(raw, MONEY_SCALE);
}

export function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function parseQuantity(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error('数量必须为大于等于 0 的整数');
  return BigInt(value.trim());
}

export function percentHundredths(current: bigint, base: bigint): number | null {
  if (base <= 0n) return null;
  const diff = current - base;
  const numerator = diff * 10_000n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = roundDiv(absolute, base);
  return Number(diff < 0n ? -rounded : rounded) / 100;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function safeNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatCurrency(value: string | number | bigint, unit = '¥'): string {
  const cents = typeof value === 'bigint' ? value : parseMoneyCents(String(value));
  return cents < 0n ? `-${unit}${formatCents(-cents)}` : `${unit}${formatCents(cents)}`;
}

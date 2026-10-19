import type { FundPrices, Trade } from './types';
import { formatCents, formatScaled, parseMoneyCents, parseScaled, parseQuantity, percentHundredths, priceAmountCents, roundDiv, roundToTick } from './decimal';

export type PriceKey = Exclude<keyof FundPrices, 'currentPrice'>;
export const PRICE_KEYS: Array<{ key: PriceKey; label: string }> = [
  { key: 'upper', label: 'BOLL 上轨' },
  { key: 'middle', label: 'BOLL 中轨' },
  { key: 'lower', label: 'BOLL 下轨' },
  { key: 'previousClose', label: '昨日收盘价' },
  { key: 'lastTradePrice', label: '上一次成交价' },
];
export type Direction = 'up' | 'down';

export interface LadderRow {
  percent: number;
  price: string;
  priceScaled: bigint;
  reached: boolean;
  isNext: boolean;
}

export function priceLadder(baseText: string, tickText: string, direction: Direction, currentText: string): LadderRow[] {
  if (!baseText.trim()) return [];
  const base = parseScaled(baseText);
  if (base <= 0n) return [];
  const tick = parseScaled(tickText || '0.001');
  const parsedCurrent = currentText.trim() ? parseScaled(currentText) : null;
  const current = parsedCurrent !== null && parsedCurrent > 0n ? parsedCurrent : null;
  if (tick <= 0n) throw new Error('最小价格变动单位必须大于零');
  const raw = Array.from({ length: 10 }, (_, index) => {
    const percent = index + 1;
    const numerator = BigInt(direction === 'up' ? 100 + percent : 100 - percent);
    const priceScaled = roundToTick(roundDiv(base * numerator, 100n), tick);
    return { percent, price: formatScaled(priceScaled, Math.max(0, (tickText.split('.')[1] || '').length)), priceScaled };
  });
  let nextAssigned = false;
  return raw.map((row) => {
    const reached = current === null ? false : direction === 'up' ? current >= row.priceScaled : current <= row.priceScaled;
    const isNext = current !== null && !reached && !nextAssigned;
    if (isNext) nextAssigned = true;
    return { ...row, reached, isNext };
  });
}

export interface PriceComparison {
  key: PriceKey;
  label: string;
  base: string;
  delta: string | null;
  percent: number | null;
  percentLabel: string;
  location: string;
}

export function compareToBases(prices: FundPrices, tickText = '0.001'): PriceComparison[] {
  if (!prices.currentPrice.trim()) return PRICE_KEYS.map(({ key, label }) => ({ key, label, base: prices[key], delta: null, percent: null, percentLabel: '待输入当前价', location: '待输入当前价' }));
  const current = parseScaled(prices.currentPrice);
  const priceDecimals = Math.max(0, Math.min(6, (tickText.split('.')[1] || '').length));
  if (current <= 0n) return PRICE_KEYS.map(({ key, label }) => ({ key, label, base: prices[key], delta: null, percent: null, percentLabel: '当前价无效', location: '当前价必须大于零' }));
  return PRICE_KEYS.map(({ key, label }) => {
    const baseText = prices[key];
    if (!baseText.trim() || parseScaled(baseText) <= 0n) {
      return { key, label, base: baseText, delta: null, percent: null, percentLabel: '基准待输入', location: '基准待输入' };
    }
    const base = parseScaled(baseText);
    const percent = percentHundredths(current, base);
    const delta = current - base;
    let location = '相同';
    if (delta > 0n) location = '基准上方';
    if (delta < 0n) location = '基准下方';
    return { key, label, base: baseText, delta: formatScaled(delta, priceDecimals), percent, percentLabel: percent === null ? '—' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`, location };
  });
}

export interface PositionSummary {
  quantity: bigint;
  costBasisCents: bigint;
  realizedCents: bigint;
  feesCents: bigint;
  grossBuyCents: bigint;
  grossSellCents: bigint;
  error?: string;
}

function compareTrades(a: Trade, b: Trade): number {
  const byTime = a.tradedAt.localeCompare(b.tradedAt);
  return byTime || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function calculatePosition(trades: Trade[], fundId: string): PositionSummary {
  let quantity = 0n;
  let costBasisCents = 0n;
  let realizedCents = 0n;
  let feesCents = 0n;
  let grossBuyCents = 0n;
  let grossSellCents = 0n;
  const sorted = trades.filter((t) => t.fundId === fundId).slice().sort(compareTrades);
  try {
    for (const trade of sorted) {
      const qty = parseQuantity(trade.quantity);
      const gross = priceAmountCents(trade.price, trade.quantity);
      const fees = parseMoneyCents(trade.commission) + parseMoneyCents(trade.transferFee) + parseMoneyCents(trade.stampDuty) + parseMoneyCents(trade.otherFee);
      if (qty <= 0n) return { quantity, costBasisCents, realizedCents, feesCents, grossBuyCents, grossSellCents, error: `交易 ${trade.tradedAt} 的数量必须大于零` };
      if (parseScaled(trade.price) <= 0n) return { quantity, costBasisCents, realizedCents, feesCents, grossBuyCents, grossSellCents, error: `交易 ${trade.tradedAt} 的价格必须大于零` };
      if (trade.side === 'BUY') {
        quantity += qty;
        costBasisCents += gross + fees;
        grossBuyCents += gross;
      } else {
        if (qty > quantity) return { quantity, costBasisCents, realizedCents, feesCents, grossBuyCents, grossSellCents, error: `卖出 ${trade.tradedAt} 的 ${qty.toString()} 份超过当时持仓 ${quantity.toString()} 份` };
        const allocatedCost = qty === quantity ? costBasisCents : roundDiv(costBasisCents * qty, quantity);
        realizedCents += gross - fees - allocatedCost;
        costBasisCents -= allocatedCost;
        quantity -= qty;
        grossSellCents += gross;
      }
      feesCents += fees;
    }
  } catch (error) {
    return { quantity, costBasisCents, realizedCents, feesCents, grossBuyCents, grossSellCents, error: error instanceof Error ? error.message : '交易数据格式无效' };
  }
  return { quantity, costBasisCents, realizedCents, feesCents, grossBuyCents, grossSellCents };
}

export const ETF_COMMISSION_RATE_PERCENT = '0.025';
export const ETF_OTHER_FEE_RATE_PERCENT = '0.004';

function estimateFixedRateFee(priceText: string, quantityText: string, ratePercent: string): string {
  if (!priceText.trim() || !quantityText.trim()) return '';
  const priceMicros = parseScaled(priceText);
  const quantity = parseQuantity(quantityText);
  // Calculate from the precise entered price before currency rounding, then round the final fee half-up to cents.
  const rateScaled = parseScaled(ratePercent);
  return formatCents(roundDiv(priceMicros * quantity * rateScaled, 1_000_000_000_000n));
}

export function estimateCommission(priceText: string, quantityText: string): string {
  return estimateFixedRateFee(priceText, quantityText, ETF_COMMISSION_RATE_PERCENT);
}

export function estimateOtherFee(priceText: string, quantityText: string): string {
  return estimateFixedRateFee(priceText, quantityText, ETF_OTHER_FEE_RATE_PERCENT);
}

export function currentValueCents(currentPriceText: string, quantity: bigint): bigint | null {
  if (!currentPriceText.trim()) return null;
  const price = parseScaled(currentPriceText);
  if (price <= 0n) return null;
  if (quantity <= 0n) return 0n;
  return roundDiv(price * quantity * 100n, 1_000_000n);
}

export function unrealizedPnlCents(currentPriceText: string, position: PositionSummary): bigint | null {
  const marketValue = currentValueCents(currentPriceText, position.quantity);
  if (marketValue === null) return null;
  return marketValue - position.costBasisCents;
}

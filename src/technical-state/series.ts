import type {
  ConfirmedTechnicalSeries,
  TechnicalBar,
  TechnicalHistoryInput,
  TechnicalInterval,
  TechnicalNormalizationResult,
  TechnicalRawBar,
} from './types';

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function intervalKey(date: string, interval: TechnicalInterval): string {
  if (interval === 'daily') return date;
  if (interval === 'monthly') return date.slice(0, 7);
  const parsed = new Date(date + 'T00:00:00.000Z');
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function invalid(interval: TechnicalInterval, reason: string): TechnicalNormalizationResult {
  return { validity: 'INVALID', interval, reason };
}

function insufficient(interval: TechnicalInterval, reason: string): TechnicalNormalizationResult {
  return { validity: 'INSUFFICIENT', interval, reason };
}

function unavailable(interval: TechnicalInterval, reason: string): TechnicalNormalizationResult {
  return { validity: 'UNAVAILABLE', interval, reason };
}

function normalizeBars(rawBars: readonly TechnicalRawBar[], interval: TechnicalInterval): TechnicalBar[] | TechnicalNormalizationResult {
  const byDate = new Map<string, number>();
  for (const bar of rawBars) {
    if (!isCalendarDate(bar.date)) return invalid(interval, `K 线日期无效：${String(bar.date)}`);
    const close = typeof bar.close === 'number' ? bar.close : Number(String(bar.close).trim());
    if (!Number.isFinite(close) || close <= 0) return invalid(interval, `收盘价无效：${bar.date}`);
    const existing = byDate.get(bar.date);
    if (existing !== undefined && existing !== close) return invalid(interval, `同一交易日期存在冲突收盘价：${bar.date}`);
    byDate.set(bar.date, close);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, close]) => ({ date, close }));
}

function latestBarIsClosed(
  latest: TechnicalBar,
  interval: TechnicalInterval,
  tradingDate: string,
  quotedAt?: string,
): boolean {
  if (intervalKey(latest.date, interval) !== intervalKey(tradingDate, interval)) return true;
  if (interval !== 'daily') return false;
  const quotedDate = quotedAt?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const time = quotedAt?.match(/(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (quotedDate !== tradingDate || !time) return false;
  return Number(time[1]) * 60 + Number(time[2]) >= 15 * 60;
}

/** Normalize raw provider bars and remove the unconfirmed latest candle by source time rules. */
export function normalizeConfirmedTechnicalSeries(input: TechnicalHistoryInput): TechnicalNormalizationResult {
  const { interval, quote } = input;
  if (!quote.tradingDate || !isCalendarDate(quote.tradingDate)) {
    return unavailable(interval, '缺少有效的源端交易日期，无法确认最新 K 线收盘状态');
  }
  const normalized = normalizeBars(input.bars, interval);
  if (!Array.isArray(normalized)) return normalized;
  if (normalized.length === 0) return insufficient(interval, '没有可用的历史 K 线');
  const latest = normalized[normalized.length - 1];
  if (latest.date > quote.tradingDate) return invalid(interval, '历史 K 线日期晚于源端交易日期');
  const latestClosed = latestBarIsClosed(latest, interval, quote.tradingDate, quote.quotedAt);
  const confirmedBars = latestClosed ? normalized : normalized.slice(0, -1);
  if (confirmedBars.length === 0) return insufficient(interval, '最新 K 线尚未收盘，且没有可用的已确认历史 K 线');
  const series: ConfirmedTechnicalSeries = {
    interval,
    asOfDate: confirmedBars[confirmedBars.length - 1].date,
    bars: confirmedBars,
    ...(input.source ? { source: input.source } : {}),
    excludedInProgressBar: !latestClosed,
  };
  return { validity: 'VALID', series };
}

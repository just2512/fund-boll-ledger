import type { ConfirmedTechnicalSeries } from './technical-state/types';

export type MacdInterval = 'daily' | 'weekly' | 'monthly';
export type MacdTone = 'bullish' | 'bearish' | 'mixed' | 'neutral' | 'unknown';
export type MacdAvailability = 'ready' | 'insufficient-history' | 'unavailable' | 'invalid-data';
export type MacdCrossDirection = 'golden' | 'death' | 'unknown';
export type MacdCrossEvent = 'golden' | 'death' | 'none' | 'unknown';
export type MacdZeroAxis = 'above' | 'below' | 'at-zero' | 'unknown';
export type MacdLineRelation = 'bullish' | 'bearish' | 'equal' | 'unknown';
export type MacdArrangement =
  | 'new-golden' | 'new-death' | 'bull-after-golden' | 'bear-after-death'
  | 'bull-history-unknown' | 'bear-history-unknown' | 'neutral' | 'unknown';
export type MacdMomentum =
  | 'bull-strengthening' | 'bull-weakening' | 'bear-strengthening'
  | 'bear-weakening' | 'neutral' | 'unknown';

export interface MacdBar { date: string; close: string | number }
export interface MacdQuoteContext { tradingDate?: string; quotedAt?: string }
export interface MacdPeriodState {
  interval: MacdInterval;
  availability: MacdAvailability;
  asOfDate?: string;
  error?: string;
  /** Number of confirmed bars consumed by the EMA chain. */
  barsUsed?: number;
  /** First confirmed bar used as the deterministic EMA seed. */
  emaSeedDate?: string;
  /** Bars beyond the current 35-bar minimum output threshold. */
  preRollBars?: number;
  dif?: number;
  dea?: number;
  histogram?: number;
  zeroAxis: MacdZeroAxis;
  lineRelation: MacdLineRelation;
  crossEvent: MacdCrossEvent;
  lastCross: MacdCrossDirection;
  arrangement: MacdArrangement;
  momentum: MacdMomentum;
  zeroTone: MacdTone;
  arrangementTone: MacdTone;
  momentumTone: MacdTone;
}
export interface MacdMultiTimeframeState {
  daily: MacdPeriodState;
  weekly: MacdPeriodState;
  monthly: MacdPeriodState;
  summary: string;
  summaryDetail: string;
  summaryTone: MacdTone;
  detailTone: MacdTone;
}

const FAST_PERIOD = 12;
const SLOW_PERIOD = 26;
const SIGNAL_PERIOD = 9;
const MIN_MACD_BARS = SLOW_PERIOD + SIGNAL_PERIOD;

function intervalKey(date: string, interval: MacdInterval): string {
  if (interval === 'daily') return date;
  if (interval === 'monthly') return date.slice(0, 7);
  const parsed = new Date(date + 'T00:00:00.000Z');
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function emptyPeriod(interval: MacdInterval, error: string, availability: MacdAvailability = 'invalid-data'): MacdPeriodState {
  return {
    interval, availability, error, zeroAxis: 'unknown', lineRelation: 'unknown', crossEvent: 'unknown',
    lastCross: 'unknown', arrangement: 'unknown', momentum: 'unknown',
    zeroTone: 'unknown', arrangementTone: 'unknown', momentumTone: 'unknown',
  };
}
export function unavailableMacdPeriod(interval: MacdInterval, error: string): MacdPeriodState {
  return emptyPeriod(interval, error, 'unavailable');
}

function ema(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let previous = values[0];
  out.push(previous);
  for (let i = 1; i < values.length; i += 1) {
    previous = values[i] * alpha + previous * (1 - alpha);
    out.push(previous);
  }
  return out;
}

function isClosedLatestPeriod(
  bars: Array<{ date: string; close: number }>,
  interval: MacdInterval,
  context: MacdQuoteContext,
): boolean {
  const tradingDate = context.tradingDate;
  const last = bars.at(-1);
  if (!tradingDate || !last || intervalKey(last.date, interval) !== intervalKey(tradingDate, interval)) return true;
  // Weekly/monthly candles close with the period itself: an intraweek 15:00 stamp proves
  // nothing about the week's close, so any bar sharing the quote's period is unconfirmed
  // and excluded. The bar is picked up only after the quote date moves past the period.
  if (interval !== 'daily') return false;
  // Daily candles close at 15:00 Beijing time. Confirm with the source stamp, never device time.
  // If missing/ambiguous, fail closed.
  const quotedDate = context.quotedAt?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const timeMatch = context.quotedAt?.match(/(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (quotedDate !== tradingDate || !timeMatch) return false;
  return Number(timeMatch[1]) * 60 + Number(timeMatch[2]) >= 15 * 60;
}

export function calculateMacdPeriod(
  sourceBars: MacdBar[],
  interval: MacdInterval,
  context: MacdQuoteContext = {},
): MacdPeriodState {
  const byDate = new Map<string, number>();
  for (const bar of sourceBars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) return emptyPeriod(interval, 'K 线日期格式无效');
    const close = typeof bar.close === 'number' ? bar.close : Number(String(bar.close).trim());
    if (!Number.isFinite(close) || close <= 0) return emptyPeriod(interval, 'K 线收盘价无效');
    const existing = byDate.get(bar.date);
    if (existing !== undefined && existing !== close) return emptyPeriod(interval, '同一交易日期存在冲突收盘价');
    byDate.set(bar.date, close);
  }
  const normalized = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
  if (normalized.length === 0) return emptyPeriod(interval, '没有可用的历史 K 线', 'unavailable');
  if (!context.tradingDate) return emptyPeriod(interval, '缺少可信行情日期，无法确认 K 线收盘状态', 'unavailable');
  const latestClosed = isClosedLatestPeriod(normalized, interval, context);
  const bars = latestClosed ? normalized : normalized.slice(0, -1);
  if (bars.length < MIN_MACD_BARS) {
    return emptyPeriod(interval, '已收盘历史 K 线不足 ' + MIN_MACD_BARS + ' 根，无法计算 MACD(12,26,9)', 'insufficient-history');
  }
  return calculateMacdFromConfirmedSeries({
    interval,
    asOfDate: bars[bars.length - 1].date,
    bars,
    excludedInProgressBar: !latestClosed,
  });
}

/** MACD calculation entry point for the shared, already-confirmed historical series. */
export function calculateMacdFromConfirmedSeries(series: ConfirmedTechnicalSeries): MacdPeriodState {
  const { interval, bars } = series;
  if (bars.length === 0) return emptyPeriod(interval, '没有已确认收盘的历史 K 线', 'insufficient-history');
  if (series.asOfDate !== bars[bars.length - 1]?.date) return emptyPeriod(interval, 'asOfDate 与最后一根确认 K 线日期不一致');
  let previousDate = '';
  for (const bar of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || bar.date <= previousDate) return emptyPeriod(interval, '确认序列日期无效、未排序或存在重复日期');
    if (!Number.isFinite(bar.close) || bar.close <= 0) return emptyPeriod(interval, '确认序列包含非正数或非有限收盘价');
    previousDate = bar.date;
  }
  if (bars.length < MIN_MACD_BARS) {
    return emptyPeriod(interval, '已确认历史 K 线不足 ' + MIN_MACD_BARS + ' 根，无法计算 MACD(12,26,9)', 'insufficient-history');
  }

  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, FAST_PERIOD);
  const slow = ema(closes, SLOW_PERIOD);
  const dif = fast.map((value, index) => value - slow[index]);
  const dea = ema(dif, SIGNAL_PERIOD);
  const histogram = dif.map((value, index) => 2 * (value - dea[index]));
  const lastIndex = bars.length - 1;
  const previousIndex = lastIndex - 1;
  const currentDif = dif[lastIndex], currentDea = dea[lastIndex], currentHistogram = histogram[lastIndex];
  const previousDif = dif[previousIndex], previousDea = dea[previousIndex], previousHistogram = histogram[previousIndex];

  let lastCross: MacdCrossDirection = 'unknown';
  for (let i = 1; i < dif.length; i += 1) {
    if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) lastCross = 'golden';
    else if (dif[i - 1] >= dea[i - 1] && dif[i] < dea[i]) lastCross = 'death';
  }
  let crossEvent: MacdCrossEvent = 'none';
  if (previousDif <= previousDea && currentDif > currentDea) {
    crossEvent = 'golden';
    lastCross = 'golden';
  } else if (previousDif >= previousDea && currentDif < currentDea) {
    crossEvent = 'death';
    lastCross = 'death';
  }

  const lineRelation: MacdLineRelation = currentDif > currentDea ? 'bullish' : currentDif < currentDea ? 'bearish' : 'equal';
  let arrangement: MacdArrangement;
  if (crossEvent === 'golden') arrangement = 'new-golden';
  else if (crossEvent === 'death') arrangement = 'new-death';
  else if (lineRelation === 'bullish') arrangement = lastCross === 'golden' ? 'bull-after-golden' : 'bull-history-unknown';
  else if (lineRelation === 'bearish') arrangement = lastCross === 'death' ? 'bear-after-death' : 'bear-history-unknown';
  else arrangement = 'neutral';

  const zeroAxis: MacdZeroAxis = currentDif > 0 ? 'above' : currentDif < 0 ? 'below' : 'at-zero';
  let momentum: MacdMomentum = 'neutral';
  if (currentHistogram > 0) {
    if (currentHistogram > previousHistogram) momentum = 'bull-strengthening';
    else if (currentHistogram < previousHistogram) momentum = 'bull-weakening';
  } else if (currentHistogram < 0) {
    if (Math.abs(currentHistogram) > Math.abs(previousHistogram)) momentum = 'bear-strengthening';
    else if (Math.abs(currentHistogram) < Math.abs(previousHistogram)) momentum = 'bear-weakening';
  }

  return {
    interval,
    availability: 'ready',
    asOfDate: bars[lastIndex].date,
    barsUsed: bars.length,
    emaSeedDate: bars[0].date,
    preRollBars: Math.max(0, bars.length - MIN_MACD_BARS),
    dif: currentDif,
    dea: currentDea,
    histogram: currentHistogram,
    zeroAxis,
    lineRelation,
    crossEvent,
    lastCross,
    arrangement,
    momentum,
    zeroTone: zeroAxis === 'above' ? 'bullish' : zeroAxis === 'below' ? 'bearish' : 'neutral',
    arrangementTone:
      arrangement === 'new-golden' || arrangement === 'bull-after-golden' ? 'bullish' :
      arrangement === 'new-death' || arrangement === 'bear-after-death' ? 'bearish' : 'neutral',
    momentumTone:
      momentum === 'bull-strengthening' ? 'bullish' :
      momentum === 'bear-strengthening' ? 'bearish' :
      momentum === 'bull-weakening' || momentum === 'bear-weakening' ? 'mixed' :
      momentum === 'neutral' ? 'neutral' : 'unknown',
  };
}

const INTERVAL_LABEL: Record<MacdInterval, string> = { monthly: '月线', weekly: '周线', daily: '日线' };

export function macdArrangementLabel(state: MacdPeriodState): string {
  if (state.availability === 'insufficient-history') return '历史不足';
  if (state.availability !== 'ready') return state.availability === 'invalid-data' ? '数据无效' : '数据不可用';
  switch (state.arrangement) {
    case 'new-golden': return '新金叉';
    case 'new-death': return '新死叉';
    case 'bull-after-golden': return '金叉后多头排列';
    case 'bear-after-death': return '死叉后空头排列';
    case 'bull-history-unknown': return '多头排列·交叉历史不足';
    case 'bear-history-unknown': return '空头排列·交叉历史不足';
    case 'neutral': return 'DIF/DEA 重合';
    default: return '状态不明';
  }
}
export function macdZeroAxisLabel(state: MacdPeriodState): string {
  if (state.availability === 'insufficient-history') return '历史不足';
  if (state.availability !== 'ready') return state.availability === 'invalid-data' ? '数据无效' : '数据不可用';
  if (state.zeroAxis === 'above') return 'DIF 零轴上方';
  if (state.zeroAxis === 'below') return 'DIF 零轴下方';
  if (state.zeroAxis === 'at-zero') return 'DIF 位于零轴';
  return '状态不明';
}
export function macdMomentumLabel(state: MacdPeriodState): string {
  if (state.availability === 'insufficient-history') return '历史不足';
  if (state.availability !== 'ready') return state.availability === 'invalid-data' ? '数据无效' : '数据不可用';
  switch (state.momentum) {
    case 'bull-strengthening': return '多头动能增强';
    case 'bull-weakening': return '多头动能减弱';
    case 'bear-strengthening': return '空头动能增强';
    case 'bear-weakening': return '空头动能减弱';
    case 'neutral': return '动能变化不明显';
    default: return '动能不明';
  }
}
export function summarizeMacdPeriods(
  periods: { daily: MacdPeriodState; weekly: MacdPeriodState; monthly: MacdPeriodState },
): MacdMultiTimeframeState {
  const ordered: MacdPeriodState[] = [periods.monthly, periods.weekly, periods.daily];
  const available = ordered.filter((state) => !state.error && state.zeroAxis !== 'unknown');
  if (available.length !== 3) {
    return {
      ...periods, summary: 'MACD 数据不完整',
      summaryDetail: available.length === 0 ? '刷新行情后重试' : '部分周期不可用',
      summaryTone: 'unknown', detailTone: 'unknown',
    };
  }
  const axes = ordered.map((state) => state.zeroAxis);
  const allBullish = axes.every((axis) => axis === 'above');
  const allBearish = axes.every((axis) => axis === 'below');
  const summary = allBullish ? '三周期 DIF 位于零轴上方' : allBearish ? '三周期 DIF 位于零轴下方' : 'DIF 零轴位置分化';
  const summaryTone: MacdTone = allBullish || allBearish ? 'neutral' : 'mixed';
  const fresh = ordered.find((state) => state.crossEvent === 'golden' || state.crossEvent === 'death');
  let summaryDetail: string;
  let detailTone: MacdTone;
  if (fresh) {
    summaryDetail = INTERVAL_LABEL[fresh.interval] + (fresh.crossEvent === 'golden' ? '新金叉' : '新死叉');
    detailTone = fresh.crossEvent === 'golden' ? 'bullish' : 'bearish';
    if ((allBullish && fresh.crossEvent === 'death') || (allBearish && fresh.crossEvent === 'golden')) detailTone = 'mixed';
  } else {
    summaryDetail = macdMomentumLabel(periods.daily);
    detailTone = periods.daily.momentumTone;
  }
  return { ...periods, summary, summaryDetail, summaryTone, detailTone };
}

import { calculateMacdFromConfirmedSeries, insufficientMacdPeriod, macdArrangementLabel, macdMomentumLabel, macdZeroAxisLabel, minimumMacdHistoryBars, unavailableMacdPeriod } from '../macd';
import type { MacdPeriodState } from '../macd';
import { calculateBollState } from './boll-state';
import type {
  BollState,
  BollStateConfig,
  ConfirmedTechnicalSeries,
  TechnicalInterval,
  TechnicalQuoteSource,
  TechnicalStateSnapshot,
  TechnicalValidity,
} from './types';

function macdValidity(_series: ConfirmedTechnicalSeries, macd: MacdPeriodState): TechnicalValidity {
  if (macd.availability === 'ready') return 'VALID';
  if (macd.availability === 'insufficient-history') return 'INSUFFICIENT';
  return 'INVALID';
}

/** Calculate BOLL and MACD from exactly the same already-confirmed historical prefix. */
export function calculateTechnicalStateSnapshot(
  series: ConfirmedTechnicalSeries,
  config?: BollStateConfig,
  quoteSource?: TechnicalQuoteSource,
): TechnicalStateSnapshot {
  const boll = calculateBollState(series, config);
  const minimumBars = minimumMacdHistoryBars(series.interval);
  const macd = series.bars.length < minimumBars
    ? insufficientMacdPeriod(series.interval, '已确认历史 K 线不足 ' + minimumBars + ' 根，当前周期 MACD 状态不发布')
    : calculateMacdFromConfirmedSeries(series);
  const macdStatus = macdValidity(series, macd);
  const validity: TechnicalValidity = boll.validity !== 'VALID' ? boll.validity : macdStatus;
  const reasons = [boll.reason, macd.error].filter((value): value is string => Boolean(value));
  return {
    interval: series.interval,
    asOfDate: series.asOfDate,
    ...(series.source ? { source: series.source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    ...(series.bars[0] ? { historyStartDate: series.bars[0].date } : {}),
    confirmedBarCount: series.bars.length,
    excludedInProgressBar: series.excludedInProgressBar,
    boll,
    macd,
    validity,
    ...(reasons.length ? { reason: reasons.join('；') } : {}),
  };
}

/** Build an explicit unavailable snapshot when normalization or provider retrieval fails. */
export function unavailableTechnicalState(
  interval: TechnicalInterval,
  validity: TechnicalValidity,
  reason: string,
  source?: TechnicalQuoteSource,
  quoteSource?: TechnicalQuoteSource,
): TechnicalStateSnapshot {
  const boll: BollState = {
    validity,
    bandwidthPhase: 'unknown',
    middleDirection: 'unknown',
    priceLocation: 'unknown',
    reason,
  };
  return {
    interval,
    ...(source ? { source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    confirmedBarCount: 0,
    excludedInProgressBar: false,
    boll,
    macd: unavailableMacdPeriod(interval, reason),
    validity,
    reason,
  };
}


const INTERVAL_DESCRIPTION: Record<TechnicalInterval, string> = {
  daily: '日线',
  weekly: '周线',
  monthly: '月线',
};

function formatTechnicalNumber(value: number | undefined, digits = 3): string {
  return value === undefined || !Number.isFinite(value) ? '未知' : value.toFixed(digits);
}

function bollBandwidthLabel(value: BollState['bandwidthPhase']): string {
  const labels: Record<BollState['bandwidthPhase'], string> = {
    contracting: '收窄',
    'contracting-persistent': '持续收窄',
    expanding: '扩张',
    'expanding-persistent': '持续扩张',
    'contracting-to-expanding': '由收窄转扩张',
    'expanding-to-contracting': '由扩张转收窄',
    flat: '走平',
    unknown: '未知',
  };
  return labels[value];
}

function bollMiddleLabel(value: BollState['middleDirection']): string {
  const labels: Record<BollState['middleDirection'], string> = {
    up: '向上',
    down: '向下',
    flat: '走平',
    'turning-up': '向上拐头',
    'turning-down': '向下拐头',
    unknown: '未知',
  };
  return labels[value];
}

function bollPriceLocationLabel(value: BollState['priceLocation']): string {
  const labels: Record<BollState['priceLocation'], string> = {
    'below-lower': '下轨下方',
    'near-lower': '接近下轨',
    'below-middle': '中轨下方',
    'above-middle': '中轨上方',
    'near-upper': '接近上轨',
    'above-upper': '上轨上方',
    unknown: '未知',
  };
  return labels[value];
}

/**
 * Render a deterministic, evidence-traceable description from an already
 * calculated snapshot. It never derives a trading direction or action.
 */
export function describeTechnicalStateSnapshot(snapshot: TechnicalStateSnapshot): string {
  const period = INTERVAL_DESCRIPTION[snapshot.interval];
  const date = snapshot.asOfDate ? '截至 ' + snapshot.asOfDate : '日期未知';
  const boll = snapshot.boll;
  const bollText = boll.validity !== 'VALID'
    ? 'BOLL ' + boll.validity + (boll.reason ? '：' + boll.reason : '')
    : [
        'BOLL(20,2) 上/中/下轨 ' +
          formatTechnicalNumber(boll.upper) + '/' +
          formatTechnicalNumber(boll.middle) + '/' +
          formatTechnicalNumber(boll.lower),
        '带宽 ' + formatTechnicalNumber(boll.bandwidthPercent, 4) + '%',
        '带宽阶段 ' + bollBandwidthLabel(boll.bandwidthPhase),
        '中轨方向 ' + bollMiddleLabel(boll.middleDirection),
        '确认收盘区间位置 ' + formatTechnicalNumber(boll.closeLocationPercent, 2) + '%（' +
          bollPriceLocationLabel(boll.priceLocation) + '）',
      ].join('；') + (boll.reason ? '；' + boll.reason : '');

  const macd = snapshot.macd;
  const macdText = macd.error
    ? 'MACD 数据不可用：' + macd.error
    : [
        'MACD(12,26,9) DIF/DEA/柱体 ' +
          formatTechnicalNumber(macd.dif, 6) + '/' +
          formatTechnicalNumber(macd.dea, 6) + '/' +
          formatTechnicalNumber(macd.histogram, 6),
        '排列 ' + macdArrangementLabel(macd),
        macdZeroAxisLabel(macd),
        '本根交叉 ' + (macd.crossEvent === 'golden' ? '金叉' : macd.crossEvent === 'death' ? '死叉' : macd.crossEvent === 'none' ? '无新交叉' : '未知'),
        macdMomentumLabel(macd),
      ].join('；');

  return period + '（' + date + '）：' + bollText + '。' + macdText +
    '。以上仅描述已确认 K 线的计算状态，不构成买卖方向或交易指令。';
}


export interface TechnicalMultiTimeframeDescription {
  /** Concise factual overview; contains no inferred trading action. */
  summary: string;
  /** One complete, as-of-specific description for each period. */
  detail: string;
}

function bollPeriodSummary(snapshot: TechnicalStateSnapshot): string {
  const boll = snapshot.boll;
  if (boll.validity === 'INSUFFICIENT') return '历史不足' + (boll.reason ? '：' + boll.reason : '');
  if (boll.validity === 'INVALID') return '数据无效' + (boll.reason ? '：' + boll.reason : '');
  return [
    '中轨' + bollMiddleLabel(boll.middleDirection),
    '带宽' + bollBandwidthLabel(boll.bandwidthPhase),
    '确认收盘' + bollPriceLocationLabel(boll.priceLocation),
  ].join('，');
}

function macdPeriodSummary(snapshot: TechnicalStateSnapshot): string {
  const macd = snapshot.macd;
  if (macd.availability === 'insufficient-history') return '历史不足' + (macd.error ? '：' + macd.error : '');
  if (macd.availability === 'invalid-data') return '数据无效' + (macd.error ? '：' + macd.error : '');
  if (macd.availability === 'unavailable') return '数据不可用' + (macd.error ? '：' + macd.error : '');
  return [
    macdZeroAxisLabel(macd),
    macdArrangementLabel(macd),
    macdMomentumLabel(macd),
    '本根' + (macd.crossEvent === 'golden' ? '新金叉' : macd.crossEvent === 'death' ? '新死叉' : macd.crossEvent === 'none' ? '无新交叉' : '交叉未知'),
  ].join('，');
}

/**
 * Summarize each period as a self-contained unit. Indicator validity is
 * reported independently; no cross-period aggregation or trading direction
 * is inferred in the copy layer.
 */
export function describeTechnicalMultiTimeframeState(
  periods: import('./types').TechnicalMultiTimeframeState,
): TechnicalMultiTimeframeDescription {
  const ordered: Array<{ label: string; snapshot: TechnicalStateSnapshot }> = [
    { label: '日线', snapshot: periods.daily },
    { label: '周线', snapshot: periods.weekly },
    { label: '月线', snapshot: periods.monthly },
  ];
  const summary = ordered.map(({ label, snapshot }) =>
    label + '：BOLL ' + bollPeriodSummary(snapshot) + '；MACD ' + macdPeriodSummary(snapshot),
  ).join('\n');
  return {
    summary,
    detail: ordered.map(({ snapshot }) => describeTechnicalStateSnapshot(snapshot)).join('\n'),
  };
}

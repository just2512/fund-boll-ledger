import { calculateMacdFromConfirmedSeries, calculateMacdHistoryFromConfirmedSeries, insufficientMacdPeriod, invalidMacdPeriod, macdArrangementLabel, macdMomentumLabel, macdZeroAxisLabel, minimumMacdHistoryBars, unavailableMacdPeriod } from '../macd';
import type { MacdPeriodState } from '../macd';
import { calculateBollHistory, calculateBollState } from './boll-state';
import { BOLL_STATE_CONFIG_VERSION, TECHNICAL_FORMULA_VERSION, bollStateConfigFor } from './config';
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
  if (macd.availability === 'unavailable') return 'UNAVAILABLE';
  return 'INVALID';
}

/** Calculate BOLL and MACD from exactly the same already-confirmed historical prefix. */
export function calculateTechnicalStateSnapshot(
  series: ConfirmedTechnicalSeries,
  config?: BollStateConfig,
  quoteSource?: TechnicalQuoteSource,
): TechnicalStateSnapshot {
  const bollHistory = calculateBollHistory(series, config);
  const referenceConfig = bollStateConfigFor(series.interval);
  const bollConfigVersion = config
    ? Object.keys(referenceConfig).every((key) =>
        config[key as keyof BollStateConfig] === referenceConfig[key as keyof BollStateConfig],
      ) ? BOLL_STATE_CONFIG_VERSION : 'custom-unversioned'
    : undefined;
  const latestBollHistory = bollHistory.at(-1);
  const boll = {
    ...calculateBollState(series, config, bollHistory),
    ...(latestBollHistory?.bandwidthPhaseStartDate ? { bandwidthPhaseStartDate: latestBollHistory.bandwidthPhaseStartDate } : {}),
    ...(latestBollHistory?.bandwidthPhaseObservationStartDate ? { bandwidthPhaseObservationStartDate: latestBollHistory.bandwidthPhaseObservationStartDate } : {}),
    ...(latestBollHistory?.middleDirectionStartDate ? { middleDirectionStartDate: latestBollHistory.middleDirectionStartDate } : {}),
    ...(latestBollHistory?.middleDirectionObservationStartDate ? { middleDirectionObservationStartDate: latestBollHistory.middleDirectionObservationStartDate } : {}),
  };
  const macdHistory = calculateMacdHistoryFromConfirmedSeries(series);
  const minimumBars = minimumMacdHistoryBars(series.interval);
  const macd = series.bars.length < minimumBars
    ? insufficientMacdPeriod(series.interval, '已确认历史 K 线不足 ' + minimumBars + ' 根，当前周期 MACD 状态不发布')
    : calculateMacdFromConfirmedSeries(series, macdHistory);
  const macdStatus = macdValidity(series, macd);
  const validity: TechnicalValidity = boll.validity !== 'VALID' ? boll.validity : macdStatus;
  const reasons = [boll.reason, macd.error].filter((value): value is string => Boolean(value));
  return {
    interval: series.interval,
    formulaVersion: TECHNICAL_FORMULA_VERSION,
    asOfDate: series.asOfDate,
    ...(series.source ? { source: series.source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    ...(series.bars[0] ? { historyStartDate: series.bars[0].date } : {}),
    confirmedBarCount: series.bars.length,
    excludedInProgressBar: series.excludedInProgressBar,
    boll,
    ...(config ? { bollConfig: config } : {}),
    ...(bollConfigVersion ? { bollConfigVersion } : {}),
    bollHistory,
    macd,
    macdHistory,
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
    formulaVersion: TECHNICAL_FORMULA_VERSION,
    ...(source ? { source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    confirmedBarCount: 0,
    excludedInProgressBar: false,
    boll,
    bollHistory: [],
    macd: validity === 'INSUFFICIENT'
      ? insufficientMacdPeriod(interval, reason)
      : validity === 'UNAVAILABLE'
        ? unavailableMacdPeriod(interval, reason)
        : invalidMacdPeriod(interval, reason),
    macdHistory: [],
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
  const bollUnknown = snapshot.bollConfig ? '未确认' : '未配置';
  const bollText = boll.validity !== 'VALID'
    ? 'BOLL ' + boll.validity + (boll.reason ? '：' + boll.reason : '')
    : [
        'BOLL(20,2) 上/中/下轨 ' +
          formatTechnicalNumber(boll.upper) + '/' +
          formatTechnicalNumber(boll.middle) + '/' +
          formatTechnicalNumber(boll.lower),
        '带宽 ' + formatTechnicalNumber(boll.bandwidthPercent, 4) + '%',
        '带宽阶段 ' + (boll.bandwidthPhase === 'unknown' ? bollUnknown : bollBandwidthLabel(boll.bandwidthPhase)),
        '中轨方向 ' + (boll.middleDirection === 'unknown' ? bollUnknown : bollMiddleLabel(boll.middleDirection)),
        '确认收盘区间位置 ' + (boll.closeLocationPercent === undefined ? bollUnknown : formatTechnicalNumber(boll.closeLocationPercent, 2) + '%') + '（' +
          (boll.priceLocation === 'unknown' ? bollUnknown : bollPriceLocationLabel(boll.priceLocation)) + '）',
      ].join('；') + (boll.reason ? '；' + boll.reason : '');

  const macd = snapshot.macd;
  const macdText = macd.availability === 'insufficient-history'
    ? 'MACD 历史不足：' + (macd.error ?? '未达到状态发布历史门槛')
    : macd.availability === 'unavailable'
      ? 'MACD 数据不可用：' + (macd.error ?? '数据来源不可用')
      : macd.availability === 'invalid-data' || macd.error
        ? 'MACD 数据无效：' + (macd.error ?? '输入数据无效')
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
  /** Conservative, score-free technical bias derived from confirmed daily/weekly/monthly states. */
  overallTrend: string;
  /** Concise factual overview; contains no inferred trading action. */
  summary: string;
  /** Structured BOLL/MACD descriptions for each interval. */
  periods: Array<{ label: string; boll: string; macd: string }>;
  /** One complete, as-of-specific description for each period. */
  detail: string;
}

function bollPeriodSummary(snapshot: TechnicalStateSnapshot): string {
  const boll = snapshot.boll;
  if (boll.validity === 'INSUFFICIENT') return '历史不足' + (boll.reason ? '：' + boll.reason : '');
  if (boll.validity === 'INVALID') return '数据无效' + (boll.reason ? '：' + boll.reason : '');
  if (boll.validity === 'UNAVAILABLE') return '数据不可用' + (boll.reason ? '：' + boll.reason : '');
  const unknown = snapshot.bollConfig ? '未确认' : '未配置';
  return [
    '中轨' + (boll.middleDirection === 'unknown' ? unknown : bollMiddleLabel(boll.middleDirection)),
    '带宽' + (boll.bandwidthPhase === 'unknown' ? unknown : bollBandwidthLabel(boll.bandwidthPhase)),
    '确认收盘' + (boll.priceLocation === 'unknown' ? unknown : bollPriceLocationLabel(boll.priceLocation)),
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
  ].join('，');
}

function compactBandwidthLabel(value: BollState['bandwidthPhase']): string {
  const labels: Record<BollState['bandwidthPhase'], string> = {
    contracting: '收口',
    'contracting-persistent': '持续收口',
    expanding: '开口',
    'expanding-persistent': '持续开口',
    'contracting-to-expanding': '收口转开口',
    'expanding-to-contracting': '开口转收口',
    flat: '带宽走平',
    unknown: '带宽未确认',
  };
  return labels[value];
}

function compactMiddleDirectionLabel(value: BollState['middleDirection']): string {
  const labels: Record<BollState['middleDirection'], string> = {
    up: '中轨向上',
    down: '中轨向下',
    flat: '中轨走平',
    'turning-up': '中轨拐头向上',
    'turning-down': '中轨拐头向下',
    unknown: '中轨未确认',
  };
  return labels[value];
}

function compactBollConditions(snapshot: TechnicalStateSnapshot): string[] {
  const boll = snapshot.boll;
  if (boll.validity === 'INSUFFICIENT') return ['BOLL历史不足'];
  if (boll.validity === 'INVALID') return ['BOLL数据无效'];
  if (boll.validity === 'UNAVAILABLE') return ['BOLL不可用'];
  if (!snapshot.bollConfig) return ['BOLL未配置'];
  return [
    compactBandwidthLabel(boll.bandwidthPhase),
    compactMiddleDirectionLabel(boll.middleDirection),
  ];
}

function compactMacdCondition(snapshot: TechnicalStateSnapshot): string {
  const macd = snapshot.macd;
  if (macd.availability === 'insufficient-history') return 'MACD历史不足';
  if (macd.availability === 'unavailable') return 'MACD不可用';
  if (macd.availability === 'invalid-data') return 'MACD数据无效';
  if (macd.crossEvent === 'golden') return 'MACD金叉';
  if (macd.crossEvent === 'death') return 'MACD死叉';
  if (macd.crossEvent === 'none') return 'MACD无新交叉';
  return 'MACD交叉未确认';
}

function compactTechnicalCondition(snapshot: TechnicalStateSnapshot): string {
  return [...compactBollConditions(snapshot), compactMacdCondition(snapshot)].join('＋');
}

type PeriodTechnicalBias = 'bullish' | 'bearish' | 'sideways' | 'mixed' | 'unknown';

/**
 * One timeframe is directionally aligned only when BOLL's confirmed middle-band
 * direction, MACD's DIF/DEA relation, and DIF's zero-axis side agree.
 * Bandwidth and the latest cross event are deliberately excluded: they describe
 * volatility and a one-bar event, not the underlying trend by themselves.
 */
function classifyPeriodTechnicalBias(snapshot: TechnicalStateSnapshot): PeriodTechnicalBias {
  const boll = snapshot.boll;
  const macd = snapshot.macd;
  if (boll.validity !== 'VALID' || !snapshot.bollConfig || macd.availability !== 'ready') return 'unknown';

  const middle = boll.middleDirection;
  const relation = macd.lineRelation;
  const zeroAxis = macd.zeroAxis;
  if (middle === 'unknown' || relation === 'unknown' || zeroAxis === 'unknown') return 'unknown';

  if ((middle === 'up' || middle === 'turning-up') && relation === 'bullish' && zeroAxis === 'above') {
    return 'bullish';
  }
  if ((middle === 'down' || middle === 'turning-down') && relation === 'bearish' && zeroAxis === 'below') {
    return 'bearish';
  }
  if (middle === 'flat' && relation === 'equal') return 'sideways';
  return 'mixed';
}

/**
 * Weekly + monthly alignment defines the medium-term bias; daily is used as
 * short-term confirmation or divergence. Missing/invalid inputs fail closed.
 * No scores, weights, cross-event shortcuts, or trading instructions are used.
 */
function overallTechnicalTrend(periods: import('./types').TechnicalMultiTimeframeState): string {
  const daily = classifyPeriodTechnicalBias(periods.daily);
  const weekly = classifyPeriodTechnicalBias(periods.weekly);
  const monthly = classifyPeriodTechnicalBias(periods.monthly);
  if ([daily, weekly, monthly].includes('unknown')) return '待确认';

  if (weekly === 'bullish' && monthly === 'bullish') {
    if (daily === 'bullish') return '多周期偏多';
    if (daily === 'bearish') return '中期偏多（短线回调）';
    if (daily === 'sideways') return '中期偏多（短线震荡）';
    return '中期偏多（短线分歧）';
  }
  if (weekly === 'bearish' && monthly === 'bearish') {
    if (daily === 'bearish') return '多周期偏空';
    if (daily === 'bullish') return '中期偏空（短线反弹）';
    if (daily === 'sideways') return '中期偏空（短线震荡）';
    return '中期偏空（短线分歧）';
  }
  if (daily === 'sideways' && weekly === 'sideways' && monthly === 'sideways') return '三周期震荡';
  return '多空分歧';
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
  const periodSummaries = ordered.map(({ label, snapshot }) => ({
    label,
    boll: bollPeriodSummary(snapshot),
    macd: macdPeriodSummary(snapshot),
  }));
  const summary = ordered
    .map(({ label, snapshot }) => label + '：' + compactTechnicalCondition(snapshot))
    .join('；') + '。';
  return {
    overallTrend: overallTechnicalTrend(periods),
    summary,
    periods: periodSummaries,
    detail: ordered.map(({ snapshot }) => describeTechnicalStateSnapshot(snapshot)).join('\n'),
  };
}

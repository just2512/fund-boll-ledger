import type { ConfirmedTechnicalSeries, TechnicalInterval } from './types';

export interface DistributionSummary {
  count: number;
  minimum: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  maximum: number;
  mean: number;
  positivePercent: number;
  negativePercent: number;
  zeroPercent: number;
}

export interface BollCalibrationMetricSet {
  bandwidthPercent: DistributionSummary;
  bandwidthChangePercent: Record<'1' | '3' | '5', DistributionSummary>;
  middleChangePercent: Record<'5' | '10' | '20', DistributionSummary>;
  closeLocationPercent: DistributionSummary;
}

export interface BollCalibrationReport {
  interval: TechnicalInterval;
  historyStartDate: string;
  asOfDate: string;
  confirmedBarCount: number;
  bollPointCount: number;
  invalidBandPointCount: number;
  metrics: BollCalibrationMetricSet;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  const valid = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (valid.length === 0) {
    throw new Error('不能对空或全为非有限数值的样本计算分布');
  }
  const sum = valid.reduce((total, value) => total + value, 0);
  const count = valid.length;
  const positive = valid.filter((value) => value > 0).length;
  const negative = valid.filter((value) => value < 0).length;
  return {
    count,
    minimum: valid[0],
    p10: quantile(valid, 0.10),
    p25: quantile(valid, 0.25),
    median: quantile(valid, 0.50),
    p75: quantile(valid, 0.75),
    p90: quantile(valid, 0.90),
    maximum: valid[count - 1],
    mean: sum / count,
    positivePercent: positive / count * 100,
    negativePercent: negative / count * 100,
    zeroPercent: (count - positive - negative) / count * 100,
  };
}

interface BollPoint {
  middle: number;
  upper: number;
  lower: number;
  bandwidthPercent: number;
  closeLocationPercent?: number;
}

function calculateBollPoints(series: ConfirmedTechnicalSeries): {
  points: Array<BollPoint | undefined>;
  invalidCount: number;
} {
  const points: Array<BollPoint | undefined> = Array.from({ length: series.bars.length }, () => undefined);
  let invalidCount = 0;
  for (let index = 19; index < series.bars.length; index += 1) {
    const window = series.bars.slice(index - 19, index + 1);
    const middle = window.reduce((sum, bar) => sum + bar.close, 0) / 20;
    const variance = window.reduce((sum, bar) => sum + (bar.close - middle) ** 2, 0) / 20;
    const deviation = Math.sqrt(variance);
    const upper = middle + 2 * deviation;
    const lower = middle - 2 * deviation;
    const bandwidthPercent = middle > 0 ? (upper - lower) / middle * 100 : Number.NaN;
    if (![middle, upper, lower, bandwidthPercent].every(Number.isFinite) || middle <= 0 || lower <= 0 || upper < lower) {
      invalidCount += 1;
      continue;
    }
    const width = upper - lower;
    const closeLocationPercent = width > 0 ? (series.bars[index].close - lower) / width * 100 : undefined;
    points[index] = {
      middle,
      upper,
      lower,
      bandwidthPercent,
      ...(closeLocationPercent === undefined || !Number.isFinite(closeLocationPercent) ? {} : { closeLocationPercent }),
    };
  }
  return { points, invalidCount };
}

function percentChange(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  const change = (current / previous - 1) * 100;
  return Number.isFinite(change) ? change : undefined;
}

/**
 * Descriptive empirical distributions only. This function deliberately does not
 * select BOLL thresholds or declare trading states.
 */
export function calibrateBollHistory(series: ConfirmedTechnicalSeries): BollCalibrationReport {
  if (series.bars.length < 20) throw new Error('已确认历史不足 20 根，不能计算 BOLL 校准数据');
  if (series.asOfDate !== series.bars[series.bars.length - 1]?.date) {
    throw new Error('asOfDate 与最后一根确认 K 线日期不一致');
  }
  const { points, invalidCount } = calculateBollPoints(series);
  const bandwidth = points.map((point) => point?.bandwidthPercent);
  const closeLocation = points.map((point) => point?.closeLocationPercent);
  const bandwidthChanges = (lookback: number) => points.flatMap((point, index) => {
    const value = percentChange(point?.bandwidthPercent, points[index - lookback]?.bandwidthPercent);
    return value === undefined ? [] : [value];
  });
  const middleChanges = (lookback: number) => points.flatMap((point, index) => {
    const value = percentChange(point?.middle, points[index - lookback]?.middle);
    return value === undefined ? [] : [value];
  });
  const required = (values: Array<number | undefined>, label: string) => {
    const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
    if (present.length === 0) throw new Error(label + ' 没有可用样本');
    return summarizeDistribution(present);
  };
  const validPoints = points.filter((point): point is BollPoint => point !== undefined);
  return {
    interval: series.interval,
    historyStartDate: series.bars[0].date,
    asOfDate: series.asOfDate,
    confirmedBarCount: series.bars.length,
    bollPointCount: validPoints.length,
    invalidBandPointCount: invalidCount,
    metrics: {
      bandwidthPercent: required(bandwidth, '带宽'),
      bandwidthChangePercent: {
        '1': required(bandwidthChanges(1), '1 根带宽变化'),
        '3': required(bandwidthChanges(3), '3 根带宽变化'),
        '5': required(bandwidthChanges(5), '5 根带宽变化'),
      },
      middleChangePercent: {
        '5': required(middleChanges(5), '5 根中轨变化'),
        '10': required(middleChanges(10), '10 根中轨变化'),
        '20': required(middleChanges(20), '20 根中轨变化'),
      },
      closeLocationPercent: required(closeLocation, '收盘区间位置'),
    },
  };
}

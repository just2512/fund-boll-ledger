import type {
  BollState,
  BollStateConfig,
  BollBandwidthPhase,
  BollPriceLocation,
  ConfirmedTechnicalSeries,
} from './types';

interface BollPoint {
  date: string;
  close: number;
  upper: number;
  middle: number;
  lower: number;
  bandwidthPercent: number;
}

type Direction = 'up' | 'down' | 'flat' | 'unknown';

function invalid(reason: string): BollState {
  return {
    validity: 'INVALID',
    bandwidthPhase: 'unknown',
    middleDirection: 'unknown',
    priceLocation: 'unknown',
    reason,
  };
}

function insufficient(reason: string): BollState {
  return {
    validity: 'INSUFFICIENT',
    bandwidthPhase: 'unknown',
    middleDirection: 'unknown',
    priceLocation: 'unknown',
    reason,
  };
}

function validateConfig(config: BollStateConfig): string | undefined {
  if (config.bollPeriod !== 20 || config.standardDeviations !== 2) return '当前契约固定为 BOLL(20,2)';
  const positiveIntegers: Array<[string, number]> = [
    ['bandwidthRankLookback', config.bandwidthRankLookback],
    ['bandwidthRankMinimumSamples', config.bandwidthRankMinimumSamples],
    ['middleDirectionLookback', config.middleDirectionLookback],
    ['confirmationBars', config.confirmationBars],
  ];
  for (const [name, value] of positiveIntegers) {
    if (!Number.isInteger(value) || value <= 0) return `${name} 必须是正整数`;
  }
  if (config.bandwidthRankMinimumSamples > config.bandwidthRankLookback) return '带宽分位最小样本数不能超过分位窗口';
  if (!Number.isFinite(config.flatTolerancePercent) || config.flatTolerancePercent < 0) return '走平容差必须是非负有限数';
  if (!Number.isFinite(config.nearBandDistancePercent) || config.nearBandDistancePercent < 0 || config.nearBandDistancePercent > 50) {
    return '接近轨道距离必须在 0 至 50 之间';
  }
  return undefined;
}

function classifyChange(changePercent: number | undefined, tolerance: number): Direction {
  if (changePercent === undefined || !Number.isFinite(changePercent)) return 'unknown';
  if (changePercent > tolerance) return 'up';
  if (changePercent < -tolerance) return 'down';
  return 'flat';
}

function classifyConfirmedTrend(
  directions: Direction[],
  confirmationBars: number,
): 'up' | 'down' | 'flat' | 'turning-up' | 'turning-down' | 'unknown' {
  if (directions.length < confirmationBars) return 'unknown';
  const current = directions.slice(-confirmationBars);
  const previous = directions.slice(-confirmationBars * 2, -confirmationBars);
  const all = (items: Direction[], direction: Direction) => items.length === confirmationBars && items.every((item) => item === direction);
  if (all(current, 'flat')) return 'flat';
  if (all(current, 'up')) return all(previous, 'down') ? 'turning-up' : 'up';
  if (all(current, 'down')) return all(previous, 'up') ? 'turning-down' : 'down';
  return 'unknown';
}

function percentChange(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return undefined;
  const value = (current / previous - 1) * 100;
  return Number.isFinite(value) ? value : undefined;
}

function calculatePoints(series: ConfirmedTechnicalSeries): Array<BollPoint | undefined> {
  const points: Array<BollPoint | undefined> = Array.from({ length: series.bars.length }, () => undefined);
  for (let index = 19; index < series.bars.length; index += 1) {
    const window = series.bars.slice(index - 19, index + 1);
    const mean = window.reduce((sum, bar) => sum + bar.close, 0) / 20;
    const variance = window.reduce((sum, bar) => sum + (bar.close - mean) ** 2, 0) / 20;
    const deviation = Math.sqrt(variance);
    const upper = mean + 2 * deviation;
    const lower = mean - 2 * deviation;
    if (![mean, upper, lower].every(Number.isFinite) || mean <= 0 || lower <= 0 || upper < lower) continue;
    const bandwidthPercent = ((upper - lower) / mean) * 100;
    if (!Number.isFinite(bandwidthPercent) || bandwidthPercent < 0) continue;
    points[index] = { date: series.bars[index].date, close: series.bars[index].close, upper, middle: mean, lower, bandwidthPercent };
  }
  return points;
}

function priceLocationWithoutThresholds(position: number | undefined): BollPriceLocation {
  if (position === undefined || !Number.isFinite(position)) return 'unknown';
  if (position < 0) return 'below-lower';
  if (position > 100) return 'above-upper';
  if (position < 50) return 'below-middle';
  if (position > 50) return 'above-middle';
  return 'unknown';
}

function priceLocation(position: number | undefined, nearDistance: number): BollPriceLocation {
  if (position === undefined || !Number.isFinite(position)) return 'unknown';
  if (position < 0) return 'below-lower';
  if (position > 100) return 'above-upper';
  if (position <= nearDistance) return 'near-lower';
  if (position >= 100 - nearDistance) return 'near-upper';
  if (position < 50) return 'below-middle';
  if (position > 50) return 'above-middle';
  return 'unknown';
}

/** Calculate a BOLL state from confirmed historical bars only. No quote/live price is accepted. */
export function calculateBollState(
  series: ConfirmedTechnicalSeries,
  config?: BollStateConfig,
): BollState {
  const configError = config ? validateConfig(config) : undefined;
  if (configError) return invalid(configError);
  if (series.bars.length === 0) return insufficient('没有已确认收盘的 K 线');
  if (series.asOfDate !== series.bars[series.bars.length - 1]?.date) return invalid('asOfDate 与最后一根确认 K 线日期不一致');

  let previousDate = '';
  for (const bar of series.bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || bar.date <= previousDate) return invalid('确认序列日期无效、未排序或存在重复日期');
    if (!Number.isFinite(bar.close) || bar.close <= 0) return invalid('确认序列包含非正数或非有限收盘价');
    previousDate = bar.date;
  }
  if (series.bars.length < 20) return insufficient('已确认收盘 K 线不足 20 根，无法计算 BOLL(20,2)');
  const latestWindow = series.bars.slice(-20);
  const latestMean = latestWindow.reduce((sum, bar) => sum + bar.close, 0) / 20;
  const latestVariance = latestWindow.reduce((sum, bar) => sum + (bar.close - latestMean) ** 2, 0) / 20;
  if (latestMean <= 0 || latestMean - 2 * Math.sqrt(latestVariance) <= 0) {
    return invalid('最近 20 根收盘价计算出的 BOLL 下轨小于或等于 0');
  }

  const points = calculatePoints(series);
  const current = points.at(-1);
  if (!current || current.date !== series.asOfDate) return invalid('最近一根确认 K 线无法形成有效 BOLL 轨道');
  const bandwidths = points.map((point) => point?.bandwidthPercent);
  const bandwidthChange1 = percentChange(current.bandwidthPercent, bandwidths.at(-2));
  const bandwidthChange3 = percentChange(current.bandwidthPercent, bandwidths.at(-4));
  const bandwidthChange5 = percentChange(current.bandwidthPercent, bandwidths.at(-6));
  const closeLocationPercent = current.upper === current.lower
    ? undefined
    : ((current.close - current.lower) / (current.upper - current.lower)) * 100;
  const reasons: string[] = [];
  if (current.upper === current.lower) reasons.push('BOLL 上下轨重合，无法计算收盘区间位置');

  if (!config) {
    reasons.push('状态阈值未配置：带宽分位、中轨方向和接近轨道标签保持 UNKNOWN');
    return {
      validity: 'VALID',
      asOfDate: current.date,
      upper: current.upper,
      middle: current.middle,
      lower: current.lower,
      bandwidthPercent: current.bandwidthPercent,
      ...(bandwidthChange1 === undefined ? {} : { bandwidthChange1 }),
      ...(bandwidthChange3 === undefined ? {} : { bandwidthChange3 }),
      ...(bandwidthChange5 === undefined ? {} : { bandwidthChange5 }),
      bandwidthPhase: 'unknown',
      middleDirection: 'unknown',
      ...(closeLocationPercent === undefined ? {} : { closeLocationPercent }),
      priceLocation: priceLocationWithoutThresholds(closeLocationPercent),
      reason: reasons.join('；'),
    };
  }

  const bandwidthChanges = bandwidths.map((value, index) =>
    value === undefined ? undefined : percentChange(value, bandwidths[index - 1]));
  const middleChanges = points.map((point, index) => {
    const prior = points[index - config.middleDirectionLookback];
    return point && prior ? percentChange(point.middle, prior.middle) : undefined;
  });
  const bandwidthDirections = bandwidthChanges.map((value) => classifyChange(value, config.flatTolerancePercent));
  const middleDirections = middleChanges.map((value) => classifyChange(value, config.flatTolerancePercent));
  const bandwidthPhase = classifyConfirmedTrend(bandwidthDirections, config.confirmationBars);
  const middleDirection = classifyConfirmedTrend(middleDirections, config.confirmationBars);

  const rankWindow = bandwidths.slice(-config.bandwidthRankLookback).filter((value): value is number => value !== undefined);
  const bandwidthPercentile = rankWindow.length >= config.bandwidthRankMinimumSamples
    ? rankWindow.filter((value) => value <= current.bandwidthPercent).length / rankWindow.length * 100
    : undefined;
  const middleChangePercent = middleChanges.at(-1);

  const mapBandwidthPhase = (phase: ReturnType<typeof classifyConfirmedTrend>): BollBandwidthPhase => {
    if (phase === 'up') return 'expanding';
    if (phase === 'down') return 'contracting';
    if (phase === 'turning-up') return 'contracting-to-expanding';
    if (phase === 'turning-down') return 'expanding-to-contracting';
    if (phase === 'flat') return 'flat';
    return 'unknown';
  };
  const finalBandwidthPhase = mapBandwidthPhase(bandwidthPhase);
  const confirmedChanges = bandwidthDirections.slice(-config.confirmationBars);
  const persistentBandwidthPhase: BollBandwidthPhase =
    finalBandwidthPhase === 'expanding' && confirmedChanges.every((item) => item === 'up') ? 'expanding-persistent' :
    finalBandwidthPhase === 'contracting' && confirmedChanges.every((item) => item === 'down') ? 'contracting-persistent' :
    finalBandwidthPhase;

  if (bandwidthPercentile === undefined) {
    reasons.push(`带宽分位样本不足：${rankWindow.length}/${config.bandwidthRankMinimumSamples}`);
  }
  return {
    validity: 'VALID',
    asOfDate: current.date,
    upper: current.upper,
    middle: current.middle,
    lower: current.lower,
    bandwidthPercent: current.bandwidthPercent,
    ...(bandwidthPercentile === undefined ? {} : { bandwidthPercentile }),
    bandwidthSampleCount: rankWindow.length,
    ...(bandwidthChange1 === undefined ? {} : { bandwidthChange1 }),
    ...(bandwidthChange3 === undefined ? {} : { bandwidthChange3 }),
    ...(bandwidthChange5 === undefined ? {} : { bandwidthChange5 }),
    ...(middleChangePercent === undefined ? {} : { middleChangePercent }),
    bandwidthPhase: persistentBandwidthPhase,
    middleDirection,
    ...(closeLocationPercent === undefined ? {} : { closeLocationPercent }),
    priceLocation: priceLocation(closeLocationPercent, config.nearBandDistancePercent),
    ...(reasons.length === 0 ? {} : { reason: reasons.join('；') }),
  };
}


/**
 * Build one BOLL result per confirmed bar. Rows remain date-aligned with the
 * source series; warm-up rows carry unknown classifications rather than being
 * dropped or backfilled.
 */
export function calculateBollHistory(
  series: ConfirmedTechnicalSeries,
  config?: BollStateConfig,
): import('./types').BollHistoryPoint[] {
  if (config && validateConfig(config)) return [];
  if (series.bars.length === 0) return [];
  if (series.asOfDate !== series.bars[series.bars.length - 1]?.date) return [];
  let previousDate = '';
  for (const bar of series.bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || bar.date <= previousDate ||
        !Number.isFinite(bar.close) || bar.close <= 0) return [];
    previousDate = bar.date;
  }

  const points = calculatePoints(series);
  const bandwidths = points.map((point) => point?.bandwidthPercent);
  const bandwidthChanges = bandwidths.map((value, index) =>
    value === undefined ? undefined : percentChange(value, bandwidths[index - 1]));
  const middleChanges = points.map((point, index) => {
    const prior = config ? points[index - config.middleDirectionLookback] : undefined;
    return point && prior ? percentChange(point.middle, prior.middle) : undefined;
  });
  const bandwidthDirections = bandwidthChanges.map((value) =>
    config ? classifyChange(value, config.flatTolerancePercent) : 'unknown' as Direction);
  const middleDirections = middleChanges.map((value) =>
    config ? classifyChange(value, config.flatTolerancePercent) : 'unknown' as Direction);

  const mapPhase = (phase: ReturnType<typeof classifyConfirmedTrend>): BollBandwidthPhase => {
    if (phase === 'up') return 'expanding';
    if (phase === 'down') return 'contracting';
    if (phase === 'turning-up') return 'contracting-to-expanding';
    if (phase === 'turning-down') return 'expanding-to-contracting';
    if (phase === 'flat') return 'flat';
    return 'unknown';
  };
  const phases: BollBandwidthPhase[] = [];
  const directions: Array<ReturnType<typeof classifyConfirmedTrend>> = [];
  const baseRows = points.map((point, index) => {
    const phaseWindow = config
      ? bandwidthDirections.slice(Math.max(0, index - config.confirmationBars * 2 + 1), index + 1)
      : [];
    const middleWindow = config
      ? middleDirections.slice(Math.max(0, index - config.confirmationBars * 2 + 1), index + 1)
      : [];
    const phase = config ? mapPhase(classifyConfirmedTrend(phaseWindow, config.confirmationBars)) : 'unknown';
    const middleDirection = config ? classifyConfirmedTrend(middleWindow, config.confirmationBars) : 'unknown';
    const confirmedChanges = config ? bandwidthDirections.slice(Math.max(0, index - config.confirmationBars + 1), index + 1) : [];
    const persistentPhase: BollBandwidthPhase =
      phase === 'expanding' && confirmedChanges.length === config?.confirmationBars && confirmedChanges.every((item) => item === 'up') ? 'expanding-persistent' :
      phase === 'contracting' && confirmedChanges.length === config?.confirmationBars && confirmedChanges.every((item) => item === 'down') ? 'contracting-persistent' :
      phase;
    const rankWindow = config
      ? bandwidths.slice(Math.max(0, index - config.bandwidthRankLookback + 1), index + 1)
          .filter((value): value is number => value !== undefined)
      : [];
    const percentile = config && point && rankWindow.length >= config.bandwidthRankMinimumSamples
      ? rankWindow.filter((value) => value <= point.bandwidthPercent).length / rankWindow.length * 100
      : undefined;
    const locationPercent = point && point.upper !== point.lower
      ? ((point.close - point.lower) / (point.upper - point.lower)) * 100
      : undefined;
    phases.push(persistentPhase);
    directions.push(middleDirection);
    return {
      date: series.bars[index].date,
      close: series.bars[index].close,
      ...(point ? {
        upper: point.upper,
        middle: point.middle,
        lower: point.lower,
        bandwidthPercent: point.bandwidthPercent,
      } : {}),
      ...(percentile === undefined ? {} : { bandwidthPercentile: percentile }),
      ...(config && point ? { bandwidthSampleCount: rankWindow.length } : {}),
      bandwidthPhase: persistentPhase,
      middleDirection,
      ...(locationPercent === undefined ? {} : { closeLocationPercent: locationPercent }),
      priceLocation: config && locationPercent !== undefined
        ? priceLocation(locationPercent, config.nearBandDistancePercent)
        : priceLocationWithoutThresholds(locationPercent),
    };
  });

  const phaseStartDates: Array<string | undefined> = [];
  const phaseObservationStartDates: Array<string | undefined> = [];
  const directionStartDates: Array<string | undefined> = [];
  const directionObservationStartDates: Array<string | undefined> = [];
  let phaseStartDate: string | undefined;
  let phaseObservationStartDate: string | undefined;
  let directionStartDate: string | undefined;
  let directionObservationStartDate: string | undefined;
  for (let index = 0; index < baseRows.length; index += 1) {
    if (index === 0 || phases[index] !== phases[index - 1]) {
      phaseStartDate = phases[index] === 'unknown' ? undefined : series.bars[index].date;
      phaseObservationStartDate = phases[index] === 'unknown' || !config
        ? undefined
        : series.bars[Math.max(0, index - config.confirmationBars + 1)].date;
    }
    if (index === 0 || directions[index] !== directions[index - 1]) {
      directionStartDate = directions[index] === 'unknown' ? undefined : series.bars[index].date;
      directionObservationStartDate = directions[index] === 'unknown' || !config
        ? undefined
        : series.bars[Math.max(0, index - config.confirmationBars + 1)].date;
    }
    phaseStartDates.push(phaseStartDate);
    phaseObservationStartDates.push(phaseObservationStartDate);
    directionStartDates.push(directionStartDate);
    directionObservationStartDates.push(directionObservationStartDate);
  }

  return baseRows.map((row, index) => ({
    ...row,
    ...(phaseStartDates[index] ? { bandwidthPhaseStartDate: phaseStartDates[index] } : {}),
    ...(phaseObservationStartDates[index] ? { bandwidthPhaseObservationStartDate: phaseObservationStartDates[index] } : {}),
    ...(directionStartDates[index] ? { middleDirectionStartDate: directionStartDates[index] } : {}),
    ...(directionObservationStartDates[index] ? { middleDirectionObservationStartDate: directionObservationStartDates[index] } : {}),
  }));
}

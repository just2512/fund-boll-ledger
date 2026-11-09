import { calculateMacdFromConfirmedSeries } from '../macd';
import type { MacdPeriodState } from '../macd';
import type { ConfirmedTechnicalSeries } from './types';

const CATEGORICAL_FIELDS = [
  'zeroAxis',
  'lineRelation',
  'crossEvent',
  'lastCross',
  'arrangement',
  'momentum',
] as const;

type MacdCategoricalField = typeof CATEGORICAL_FIELDS[number];

export interface MacdSeedSensitivityCandidate {
  requestedBars: number;
  barsUsed: number;
  emaSeedDate: string;
  preRollBars: number;
  numericDeltaBpsOfClose: {
    dif: number;
    dea: number;
    histogram: number;
  };
  categoricalDifferences: MacdCategoricalField[];
  matchesCategoricalReference: boolean;
  state: Pick<MacdPeriodState, MacdCategoricalField | 'dif' | 'dea' | 'histogram'>;
}

export interface MacdSeedSensitivityReport {
  interval: ConfirmedTechnicalSeries['interval'];
  asOfDate: string;
  confirmedBarCount: number;
  reference: Pick<MacdPeriodState, MacdCategoricalField | 'dif' | 'dea' | 'histogram' | 'emaSeedDate' | 'preRollBars'>;
  candidates: MacdSeedSensitivityCandidate[];
}

/**
 * Compare the latest MACD output after changing only the historical seed date.
 * Every candidate uses a suffix ending on the same confirmed as-of date.
 * This reports numeric and categorical sensitivity; it does not declare a
 * convergence threshold or change the production EMA initialization rule.
 */
export function analyzeMacdHistoryStartSensitivity(
  series: ConfirmedTechnicalSeries,
  candidateLengths: readonly number[],
): MacdSeedSensitivityReport {
  if (series.bars.length < 35) {
    throw new Error('MACD 历史起点敏感性分析至少需要 35 根确认 K 线');
  }
  if (series.asOfDate !== series.bars.at(-1)?.date) {
    throw new Error('MACD 历史起点敏感性分析要求 asOfDate 与最后一根确认 K 线一致');
  }

  const seen = new Set<number>();
  for (const length of candidateLengths) {
    if (!Number.isInteger(length) || length < 35) {
      throw new Error('MACD 候选历史长度必须是大于或等于 35 的整数');
    }
    if (seen.has(length)) throw new Error('MACD 候选历史长度不得重复：' + length);
    seen.add(length);
  }

  const referenceState = calculateMacdFromConfirmedSeries(series);
  const referenceDif = referenceState.dif;
  const referenceDea = referenceState.dea;
  const referenceHistogram = referenceState.histogram;
  if (referenceState.error || referenceDif === undefined ||
      referenceDea === undefined || referenceHistogram === undefined) {
    throw new Error('完整确认序列无法计算 MACD：' + (referenceState.error ?? '缺少数值结果'));
  }
  const latestClose = series.bars[series.bars.length - 1].close;
  const reference = {
    dif: referenceState.dif,
    dea: referenceState.dea,
    histogram: referenceState.histogram,
    zeroAxis: referenceState.zeroAxis,
    lineRelation: referenceState.lineRelation,
    crossEvent: referenceState.crossEvent,
    lastCross: referenceState.lastCross,
    arrangement: referenceState.arrangement,
    momentum: referenceState.momentum,
    emaSeedDate: referenceState.emaSeedDate!,
    preRollBars: referenceState.preRollBars!,
  };

  const candidates = candidateLengths
    .filter((length) => length < series.bars.length)
    .map((length): MacdSeedSensitivityCandidate => {
      const bars = series.bars.slice(-length);
      const suffix: ConfirmedTechnicalSeries = {
        ...series,
        asOfDate: bars[bars.length - 1].date,
        bars,
      };
      const state = calculateMacdFromConfirmedSeries(suffix);
      if (state.error || state.dif === undefined || state.dea === undefined || state.histogram === undefined) {
        throw new Error(`MACD 候选历史长度 ${length} 无法计算：${state.error ?? '缺少数值结果'}`);
      }
      const categoricalDifferences = CATEGORICAL_FIELDS.filter((field) => state[field] !== referenceState[field]);
      return {
        requestedBars: length,
        barsUsed: state.barsUsed!,
        emaSeedDate: state.emaSeedDate!,
        preRollBars: state.preRollBars!,
        numericDeltaBpsOfClose: {
          dif: Math.abs(state.dif - referenceDif) / latestClose * 10_000,
          dea: Math.abs(state.dea - referenceDea) / latestClose * 10_000,
          histogram: Math.abs(state.histogram - referenceHistogram) / latestClose * 10_000,
        },
        categoricalDifferences: [...categoricalDifferences],
        matchesCategoricalReference: categoricalDifferences.length === 0,
        state: {
          dif: state.dif,
          dea: state.dea,
          histogram: state.histogram,
          zeroAxis: state.zeroAxis,
          lineRelation: state.lineRelation,
          crossEvent: state.crossEvent,
          lastCross: state.lastCross,
          arrangement: state.arrangement,
          momentum: state.momentum,
        },
      };
    });

  return {
    interval: series.interval,
    asOfDate: series.asOfDate,
    confirmedBarCount: series.bars.length,
    reference,
    candidates,
  };
}

export interface MacdSeedRollingCandidateSummary {
  requestedBars: number;
  sampleCount: number;
  categoricalMismatchCount: number;
  firstCategoricalMismatch?: {
    asOfDate: string;
    fields: MacdCategoricalField[];
  };
  maxNumericDeltaBpsOfClose: {
    dif: number;
    dea: number;
    histogram: number;
  };
  maxDeltaDates: {
    dif: string;
    dea: string;
    histogram: string;
  };
}

export interface MacdSeedRollingSensitivityReport {
  interval: ConfirmedTechnicalSeries['interval'];
  historyStartDate: string;
  historyEndDate: string;
  confirmedBarCount: number;
  endpointCount: number;
  candidates: MacdSeedRollingCandidateSummary[];
}

/**
 * Repeat the seed comparison at every historical as-of date in the loaded series.
 * Each reference and suffix ends on the same date, so no future bar can affect an
 * earlier endpoint. Results are descriptive and do not choose an acceptable tolerance.
 */
export function analyzeMacdHistoryStartSensitivityAcrossPrefixes(
  series: ConfirmedTechnicalSeries,
  candidateLengths: readonly number[],
): MacdSeedRollingSensitivityReport {
  if (series.bars.length < 35) {
    throw new Error('MACD 历史起点滚动敏感性分析至少需要 35 根确认 K 线');
  }
  if (series.asOfDate !== series.bars.at(-1)?.date) {
    throw new Error('MACD 历史起点滚动敏感性分析要求 asOfDate 与最后一根确认 K 线一致');
  }

  const seen = new Set<number>();
  for (const length of candidateLengths) {
    if (!Number.isInteger(length) || length < 35) {
      throw new Error('MACD 候选历史长度必须是大于或等于 35 的整数');
    }
    if (seen.has(length)) throw new Error('MACD 候选历史长度不得重复：' + length);
    seen.add(length);
  }

  const summaries = new Map<number, MacdSeedRollingCandidateSummary>();
  for (const length of candidateLengths) {
    summaries.set(length, {
      requestedBars: length,
      sampleCount: 0,
      categoricalMismatchCount: 0,
      maxNumericDeltaBpsOfClose: { dif: 0, dea: 0, histogram: 0 },
      maxDeltaDates: { dif: '', dea: '', histogram: '' },
    });
  }

  let endpointCount = 0;
  for (let prefixLength = 35; prefixLength <= series.bars.length; prefixLength += 1) {
    const prefixBars = series.bars.slice(0, prefixLength);
    const prefix: ConfirmedTechnicalSeries = {
      ...series,
      asOfDate: prefixBars[prefixBars.length - 1].date,
      bars: prefixBars,
      excludedInProgressBar: false,
    };
    const referenceState = calculateMacdFromConfirmedSeries(prefix);
    if (referenceState.error || referenceState.dif === undefined ||
        referenceState.dea === undefined || referenceState.histogram === undefined) {
      throw new Error('历史前缀无法计算 MACD：' + (referenceState.error ?? prefix.asOfDate));
    }
    const referenceDif = referenceState.dif;
    const referenceDea = referenceState.dea;
    const referenceHistogram = referenceState.histogram;
    const latestClose = prefixBars[prefixBars.length - 1].close;
    endpointCount += 1;

    for (const length of candidateLengths) {
      if (length >= prefixLength) continue;
      const suffixBars = prefixBars.slice(-length);
      const suffix: ConfirmedTechnicalSeries = {
        ...prefix,
        bars: suffixBars,
      };
      const state = calculateMacdFromConfirmedSeries(suffix);
      if (state.error || state.dif === undefined || state.dea === undefined || state.histogram === undefined) {
        throw new Error(`历史日期 ${prefix.asOfDate} 的 ${length} 根 MACD 候选无法计算：${state.error ?? '缺少数值结果'}`);
      }
      const summary = summaries.get(length)!;
      summary.sampleCount += 1;
      const deltas = {
        dif: Math.abs(state.dif - referenceDif) / latestClose * 10_000,
        dea: Math.abs(state.dea - referenceDea) / latestClose * 10_000,
        histogram: Math.abs(state.histogram - referenceHistogram) / latestClose * 10_000,
      };
      for (const key of ['dif', 'dea', 'histogram'] as const) {
        if (deltas[key] > summary.maxNumericDeltaBpsOfClose[key]) {
          summary.maxNumericDeltaBpsOfClose[key] = deltas[key];
          summary.maxDeltaDates[key] = prefix.asOfDate;
        }
      }
      const categoricalDifferences = CATEGORICAL_FIELDS.filter((field) => state[field] !== referenceState[field]);
      if (categoricalDifferences.length > 0) {
        summary.categoricalMismatchCount += 1;
        if (!summary.firstCategoricalMismatch) {
          summary.firstCategoricalMismatch = {
            asOfDate: prefix.asOfDate,
            fields: [...categoricalDifferences],
          };
        }
      }
    }
  }

  return {
    interval: series.interval,
    historyStartDate: series.bars[0].date,
    historyEndDate: series.asOfDate,
    confirmedBarCount: series.bars.length,
    endpointCount,
    candidates: [...summaries.values()],
  };
}

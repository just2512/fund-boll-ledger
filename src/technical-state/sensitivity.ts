import { calculateBollState } from './boll-state';
import { hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import type { BollState, BollStateConfig, ConfirmedTechnicalSeries, TechnicalInterval } from './types';

export interface BollSensitivityCandidate {
  id: string;
  /** Explicit exploratory configuration; no candidate is selected automatically. */
  config: BollStateConfig;
}

export interface BollSensitivityCandidateResult {
  id: string;
  config: BollStateConfig;
  replayedPrefixCount: number;
  noFutureBars: boolean;
  firstValidDate?: string;
  lastValidDate?: string;
  validityCounts: Record<'VALID' | 'INSUFFICIENT' | 'INVALID', number>;
  bandwidthPhaseCounts: Record<string, number>;
  middleDirectionCounts: Record<string, number>;
  priceLocationCounts: Record<string, number>;
  bandwidthPhaseTransitionCount: number;
  middleDirectionTransitionCount: number;
  priceLocationTransitionCount: number;
}

export interface BollSensitivityPairComparison {
  leftCandidateId: string;
  rightCandidateId: string;
  comparableDates: number;
  identicalStateDates: number;
}

export interface BollSensitivityReport {
  interval: TechnicalInterval;
  historyStartDate: string;
  asOfDate: string;
  confirmedBarCount: number;
  thresholdSelection: 'NOT_PERFORMED';
  candidates: BollSensitivityCandidateResult[];
  pairComparisons: BollSensitivityPairComparison[];
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function stateSignature(state: BollState): string {
  return [
    state.validity,
    state.bandwidthPhase,
    state.middleDirection,
    state.priceLocation,
  ].join('|');
}

function summarizeCandidate(
  series: ConfirmedTechnicalSeries,
  candidate: BollSensitivityCandidate,
): { result: BollSensitivityCandidateResult; statesByDate: Map<string, BollState> } {
  const replay = replayConfirmedTechnicalSeries(series, (prefix) => calculateBollState(prefix, candidate.config));
  const validityCounts = { VALID: 0, INSUFFICIENT: 0, INVALID: 0 };
  const bandwidthPhaseCounts: Record<string, number> = {};
  const middleDirectionCounts: Record<string, number> = {};
  const priceLocationCounts: Record<string, number> = {};
  const statesByDate = new Map<string, BollState>();
  let firstValidDate: string | undefined;
  let lastValidDate: string | undefined;
  let bandwidthPhaseTransitionCount = 0;
  let middleDirectionTransitionCount = 0;
  let priceLocationTransitionCount = 0;
  let previous: BollState | undefined;

  for (const entry of replay) {
    const state = entry.result;
    statesByDate.set(entry.asOfDate, state);
    validityCounts[state.validity] += 1;
    increment(bandwidthPhaseCounts, state.bandwidthPhase);
    increment(middleDirectionCounts, state.middleDirection);
    increment(priceLocationCounts, state.priceLocation);

    if (state.validity === 'VALID') {
      firstValidDate ??= entry.asOfDate;
      lastValidDate = entry.asOfDate;
      if (previous?.validity === 'VALID') {
        if (previous.bandwidthPhase !== state.bandwidthPhase) bandwidthPhaseTransitionCount += 1;
        if (previous.middleDirection !== state.middleDirection) middleDirectionTransitionCount += 1;
        if (previous.priceLocation !== state.priceLocation) priceLocationTransitionCount += 1;
      }
      previous = state;
    } else {
      previous = undefined;
    }
  }

  return {
    result: {
      id: candidate.id,
      config: { ...candidate.config },
      replayedPrefixCount: replay.length,
      noFutureBars: hasNoFutureBars(replay),
      ...(firstValidDate ? { firstValidDate } : {}),
      ...(lastValidDate ? { lastValidDate } : {}),
      validityCounts,
      bandwidthPhaseCounts,
      middleDirectionCounts,
      priceLocationCounts,
      bandwidthPhaseTransitionCount,
      middleDirectionTransitionCount,
      priceLocationTransitionCount,
    },
    statesByDate,
  };
}

/**
 * One-factor-at-a-time sensitivity report over caller-supplied configurations.
 * Every historical observation is recalculated from its confirmed prefix only.
 * The report describes sensitivity; it does not rank or select trading thresholds.
 */
export function analyzeBollConfigSensitivity(
  series: ConfirmedTechnicalSeries,
  candidates: readonly BollSensitivityCandidate[],
): BollSensitivityReport {
  if (candidates.length === 0) throw new Error('至少需要一个明确配置的敏感性候选项');
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim()) throw new Error('敏感性候选项 ID 不能为空');
    if (ids.has(candidate.id)) throw new Error('敏感性候选项 ID 不得重复：' + candidate.id);
    ids.add(candidate.id);
  }
  if (series.bars.length === 0 || series.asOfDate !== series.bars.at(-1)?.date) {
    throw new Error('敏感性分析要求非空且 asOfDate 与最后一根确认 K 线一致的序列');
  }

  const evaluated = candidates.map((candidate) => summarizeCandidate(series, candidate));
  const pairComparisons: BollSensitivityPairComparison[] = [];
  for (let left = 0; left < evaluated.length; left += 1) {
    for (let right = left + 1; right < evaluated.length; right += 1) {
      let comparableDates = 0;
      let identicalStateDates = 0;
      for (const [date, leftState] of evaluated[left].statesByDate) {
        const rightState = evaluated[right].statesByDate.get(date);
        if (!rightState || leftState.validity !== 'VALID' || rightState.validity !== 'VALID') continue;
        comparableDates += 1;
        if (stateSignature(leftState) === stateSignature(rightState)) identicalStateDates += 1;
      }
      pairComparisons.push({
        leftCandidateId: candidates[left].id,
        rightCandidateId: candidates[right].id,
        comparableDates,
        identicalStateDates,
      });
    }
  }

  return {
    interval: series.interval,
    historyStartDate: series.bars[0].date,
    asOfDate: series.asOfDate,
    confirmedBarCount: series.bars.length,
    thresholdSelection: 'NOT_PERFORMED',
    candidates: evaluated.map(({ result }) => result),
    pairComparisons,
  };
}

function makeConfig(
  interval: TechnicalInterval,
  bandwidthRankLookback: number,
  middleDirectionLookback: number,
  flatTolerancePercent: number,
  confirmationBars: number,
  nearBandDistancePercent: number,
): BollStateConfig {
  return {
    bollPeriod: 20,
    standardDeviations: 2,
    bandwidthRankLookback,
    bandwidthRankMinimumSamples: Math.ceil(bandwidthRankLookback * 0.75),
    middleDirectionLookback,
    flatTolerancePercent,
    confirmationBars,
    nearBandDistancePercent,
  };
}

/**
 * Period-specific exploratory ranges represent roughly comparable calendar
 * horizons. They are study candidates, not defaults or recommendations.
 */
export function buildBollSensitivityCandidates(interval: TechnicalInterval): BollSensitivityCandidate[] {
  const profile = interval === 'daily'
    ? { rank: [60, 120, 240], direction: [5, 10, 20] }
    : interval === 'weekly'
      ? { rank: [13, 26, 52], direction: [2, 4, 8] }
      : { rank: [3, 6, 12], direction: [2, 3, 6] };
  const [rankShort, rankAnchor, rankLong] = profile.rank;
  const [directionShort, directionAnchor, directionLong] = profile.direction;
  const anchor = makeConfig(interval, rankAnchor, directionAnchor, 0.1, 3, 10);
  const withConfig = (id: string, config: BollStateConfig): BollSensitivityCandidate => ({ id, config });
  return [
    withConfig('anchor-reference-only', anchor),
    withConfig('rank-short', makeConfig(interval, rankShort, directionAnchor, 0.1, 3, 10)),
    withConfig('rank-long', makeConfig(interval, rankLong, directionAnchor, 0.1, 3, 10)),
    withConfig('direction-short', makeConfig(interval, rankAnchor, directionShort, 0.1, 3, 10)),
    withConfig('direction-long', makeConfig(interval, rankAnchor, directionLong, 0.1, 3, 10)),
    withConfig('flat-tolerance-low', makeConfig(interval, rankAnchor, directionAnchor, 0.05, 3, 10)),
    withConfig('flat-tolerance-high', makeConfig(interval, rankAnchor, directionAnchor, 0.2, 3, 10)),
    withConfig('confirmation-short', makeConfig(interval, rankAnchor, directionAnchor, 0.1, 2, 10)),
    withConfig('confirmation-long', makeConfig(interval, rankAnchor, directionAnchor, 0.1, 4, 10)),
    withConfig('near-band-short', makeConfig(interval, rankAnchor, directionAnchor, 0.1, 3, 5)),
    withConfig('near-band-long', makeConfig(interval, rankAnchor, directionAnchor, 0.1, 3, 15)),
  ];
}

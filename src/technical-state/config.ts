import type { BollStateConfig, TechnicalInterval } from './types';

/**
 * Descriptive reference configuration calibrated against 4 ETFs × 3 intervals.
 * These are display-classification parameters, not trading thresholds or a
 * performance-optimized strategy. Keep the sensitivity report alongside them.
 */
export const TECHNICAL_FORMULA_VERSION = 'technical-formula-v1';

export const BOLL_STATE_CONFIG_VERSION = 'reference-2026-11-09';

export const BOLL_STATE_CONFIG_BY_INTERVAL: Readonly<Record<TechnicalInterval, BollStateConfig>> = {
  daily: {
    bollPeriod: 20,
    standardDeviations: 2,
    bandwidthRankLookback: 120,
    bandwidthRankMinimumSamples: 90,
    middleDirectionLookback: 10,
    flatTolerancePercent: 0.1,
    confirmationBars: 3,
    nearBandDistancePercent: 10,
  },
  weekly: {
    bollPeriod: 20,
    standardDeviations: 2,
    bandwidthRankLookback: 26,
    bandwidthRankMinimumSamples: 20,
    middleDirectionLookback: 4,
    flatTolerancePercent: 0.1,
    confirmationBars: 3,
    nearBandDistancePercent: 10,
  },
  monthly: {
    bollPeriod: 20,
    standardDeviations: 2,
    bandwidthRankLookback: 6,
    bandwidthRankMinimumSamples: 5,
    middleDirectionLookback: 3,
    flatTolerancePercent: 0.1,
    confirmationBars: 3,
    nearBandDistancePercent: 10,
  },
};

export function bollStateConfigFor(interval: TechnicalInterval): BollStateConfig {
  return { ...BOLL_STATE_CONFIG_BY_INTERVAL[interval] };
}

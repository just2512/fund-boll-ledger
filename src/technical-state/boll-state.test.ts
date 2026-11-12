import { describe, expect, it } from 'vitest';
import { calculateBollHistory, calculateBollState } from './boll-state';
import type { BollStateConfig, ConfirmedTechnicalSeries, TechnicalBar } from './types';

const config: BollStateConfig = {
  bollPeriod: 20,
  standardDeviations: 2,
  bandwidthRankLookback: 60,
  bandwidthRankMinimumSamples: 20,
  middleDirectionLookback: 3,
  flatTolerancePercent: 0.01,
  confirmationBars: 2,
  nearBandDistancePercent: 10,
};

function series(closes: number[]): ConfirmedTechnicalSeries {
  const bars: TechnicalBar[] = closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    close,
  }));
  return { interval: 'daily', asOfDate: bars.at(-1)?.date ?? '', bars, excludedInProgressBar: false, source: '东方财富' };
}

describe('calculateBollState', () => {
  it('calculates BOLL(20,2) from confirmed closes using population standard deviation', () => {
    const input = series(Array.from({ length: 20 }, (_, index) => index + 21));
    const state = calculateBollState(input, config);
    const mean = 30.5;
    const variance = Array.from({ length: 20 }, (_, index) => (index + 21 - mean) ** 2).reduce((a, b) => a + b, 0) / 20;
    const deviation = Math.sqrt(variance);
    expect(state.validity).toBe('VALID');
    expect(state.middle).toBeCloseTo(mean, 12);
    expect(state.upper).toBeCloseTo(mean + 2 * deviation, 12);
    expect(state.lower).toBeCloseTo(mean - 2 * deviation, 12);
  });

  it('rejects a non-positive lower band instead of emitting an invalid price range', () => {
    const state = calculateBollState(series(Array.from({ length: 20 }, (_, index) => index + 1)), config);
    expect(state.validity).toBe('INVALID');
    expect(state.reason).toContain('下轨');
  });

  it('does not emit a bandwidth percentile before the configured minimum sample count', () => {
    const state = calculateBollState(series(Array.from({ length: 30 }, (_, index) => 10 + index / 100)), config);
    expect(state.validity).toBe('VALID');
    expect(state.bandwidthPercentile).toBeUndefined();
    expect(state.reason).toContain('带宽分位样本不足');
  });

  it('computes the percentile only from the trailing window ending at the as-of bar', () => {
    const closes = Array.from({ length: 80 }, (_, index) => 10 + Math.sin(index / 3) * 0.2 + index * 0.001);
    const all = series(closes);
    const prefix = series(closes.slice(0, 70));
    const prefixState = calculateBollState(prefix, config);
    const allState = calculateBollState(all, config);
    expect(prefixState.asOfDate).not.toBe(allState.asOfDate);
    expect(prefixState.bandwidthPercentile).toBeDefined();
    expect(allState.bandwidthPercentile).toBeDefined();
  });

  it('keeps close position outside the 0-100 band instead of clamping it', () => {
    const input = series([...Array(19).fill(10), 11]);
    const state = calculateBollState(input, config);
    expect(state.validity).toBe('VALID');
    expect(state.closeLocationPercent).toBeGreaterThan(100);
    expect(state.priceLocation).toBe('above-upper');
  });

  it('rejects unsorted, duplicate, or invalid confirmed series', () => {
    const valid = series(Array.from({ length: 20 }, (_, index) => index + 1));
    const duplicate = { ...valid, bars: [...valid.bars, valid.bars.at(-1)!] };
    expect(calculateBollState(duplicate, config).validity).toBe('INVALID');
    const unsorted = { ...valid, bars: [...valid.bars].reverse() };
    expect(calculateBollState(unsorted, config).validity).toBe('INVALID');
    const invalid = { ...valid, bars: valid.bars.map((bar, index) => index === 5 ? { ...bar, close: Number.NaN } : bar) };
    expect(calculateBollState(invalid, config).validity).toBe('INVALID');
  });

  it('returns INSUFFICIENT rather than inventing a state for fewer than 20 bars', () => {
    const state = calculateBollState(series(Array.from({ length: 19 }, (_, index) => index + 1)), config);
    expect(state.validity).toBe('INSUFFICIENT');
    expect(state.bandwidthPhase).toBe('unknown');
  });

  it('requires explicit valid configuration values', () => {
    const state = calculateBollState(series(Array.from({ length: 25 }, (_, index) => index + 1)), {
      ...config,
      bandwidthRankMinimumSamples: 80,
    });
    expect(state.validity).toBe('INVALID');
  });
  it('recognizes a confirmed middle-band turn without relying on the live quote', () => {
    const closes = Array.from({ length: 93 }, (_, index) => {
      if (index < 90) return 20 - index * 0.05;
      if (index === 90) return 18;
      if (index === 91) return 18.1;
      return 18.2;
    });
    const state = calculateBollState(series(closes), config);
    expect(state.validity).toBe('VALID');
    expect(state.middleDirection).toBe('turning-up');
  });

  it('records both the first confirmed state date and its N-bar observation window start', () => {
    const input = series(Array.from({ length: 40 }, (_, index) => 10 + index * 0.1));
    const history = calculateBollHistory(input, { ...config, confirmationBars: 2 });
    const firstConfirmed = history.findIndex((point) => point.bandwidthPhase !== 'unknown');
    expect(firstConfirmed).toBeGreaterThan(0);
    expect(history[firstConfirmed].bandwidthPhaseStartDate).toBe(history[firstConfirmed].date);
    expect(history[firstConfirmed].bandwidthPhaseObservationStartDate).toBe(history[firstConfirmed - 1].date);
  });

});

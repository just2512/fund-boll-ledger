import { describe, expect, it } from 'vitest';
import { analyzeBollConfigSensitivity, buildBollSensitivityCandidates } from './sensitivity';
import type { ConfirmedTechnicalSeries, TechnicalBar } from './types';

function makeSeries(count = 320): ConfirmedTechnicalSeries {
  const bars: TechnicalBar[] = Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    close: 3 + index * 0.002 + Math.sin(index / 5) * 0.08 + Math.sin(index / 17) * 0.12,
  }));
  return {
    interval: 'daily',
    asOfDate: bars.at(-1)!.date,
    bars,
    source: '东方财富',
    excludedInProgressBar: false,
  };
}

describe('BOLL parameter sensitivity analysis', () => {
  it('builds period-specific exploratory candidates without selecting thresholds', () => {
    const daily = buildBollSensitivityCandidates('daily');
    const weekly = buildBollSensitivityCandidates('weekly');
    const monthly = buildBollSensitivityCandidates('monthly');
    expect(daily).toHaveLength(11);
    expect(weekly).toHaveLength(11);
    expect(monthly).toHaveLength(11);
    expect(daily[0].config.bandwidthRankLookback).toBe(120);
    expect(weekly[0].config.bandwidthRankLookback).toBe(26);
    expect(monthly[0].config.bandwidthRankLookback).toBe(6);
    expect(daily.every((candidate) => candidate.config.bollPeriod === 20 && candidate.config.standardDeviations === 2)).toBe(true);
  });

  it('replays every confirmed prefix, reports transitions, and compares candidates on common dates', () => {
    const series = makeSeries();
    const candidates = buildBollSensitivityCandidates('daily').slice(0, 3);
    const report = analyzeBollConfigSensitivity(series, candidates);
    expect(report.thresholdSelection).toBe('NOT_PERFORMED');
    expect(report.asOfDate).toBe(series.asOfDate);
    expect(report.confirmedBarCount).toBe(series.bars.length);
    expect(report.candidates).toHaveLength(3);
    expect(report.candidates.every((candidate) => candidate.noFutureBars)).toBe(true);
    expect(report.candidates.every((candidate) => candidate.replayedPrefixCount === series.bars.length)).toBe(true);
    expect(report.pairComparisons).toHaveLength(3);
    expect(report.candidates.every((candidate) => candidate.bandwidthPercentileSampleCount > 0)).toBe(true);
    expect(report.candidates.every((candidate) => candidate.bandwidthPercentileDistribution?.count === candidate.bandwidthPercentileSampleCount)).toBe(true);
    expect(report.pairComparisons.every((comparison) => comparison.comparableDates > 0)).toBe(true);
    expect(report.pairComparisons.every((comparison) => comparison.bandwidthPercentileComparableDates > 0)).toBe(true);
    expect(report.pairComparisons[0].bandwidthPercentileMeanAbsoluteDifference).toBeGreaterThan(0);
  });

  it('rejects duplicate candidate identifiers rather than silently overwriting comparisons', () => {
    const candidates = buildBollSensitivityCandidates('daily').slice(0, 2);
    candidates[1] = { ...candidates[1], id: candidates[0].id };
    expect(() => analyzeBollConfigSensitivity(makeSeries(), candidates)).toThrow('不得重复');
  });
});

import { describe, expect, it } from 'vitest';
import { calibrateBollHistory, summarizeDistribution } from './calibration';
import type { ConfirmedTechnicalSeries, TechnicalBar } from './types';

function series(closes: number[]): ConfirmedTechnicalSeries {
  const bars: TechnicalBar[] = closes.map((close, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close,
  }));
  return {
    interval: 'daily',
    asOfDate: bars.at(-1)?.date ?? '',
    bars,
    excludedInProgressBar: false,
    source: '东方财富',
  };
}

describe('BOLL calibration distribution summaries', () => {
  it('calculates interpolated quantiles and sign proportions from finite values', () => {
    expect(summarizeDistribution([1, 2, 3, 4, 5])).toEqual({
      count: 5,
      minimum: 1,
      p10: 1.4,
      p25: 2,
      median: 3,
      p75: 4,
      p90: 4.6,
      maximum: 5,
      mean: 3,
      positivePercent: 100,
      negativePercent: 0,
      zeroPercent: 0,
    });
    expect(summarizeDistribution([-2, 0, 2]).negativePercent).toBeCloseTo(100 / 3);
    expect(summarizeDistribution([-2, 0, 2]).zeroPercent).toBeCloseTo(100 / 3);
  });

  it('rejects empty and non-finite-only samples', () => {
    expect(() => summarizeDistribution([])).toThrow('空');
    expect(() => summarizeDistribution([Number.NaN, Number.POSITIVE_INFINITY])).toThrow('空');
  });

  it('reports exact confirmed-bar dates for mathematically invalid lower bands', () => {
    const closes = [
      ...Array.from({ length: 20 }, (_, index) => index + 1),
      ...Array.from({ length: 80 }, (_, index) => 100 + index / 10),
    ];
    const report = calibrateBollHistory(series(closes));
    expect(report.invalidBandPointCount).toBeGreaterThan(0);
    expect(report.invalidBandDates).toContain('2025-01-20');
    expect(report.invalidBandDates.length).toBe(report.invalidBandPointCount);
    expect(report.invalidBandDiagnostics).toHaveLength(report.invalidBandPointCount);
    expect(report.invalidBandDiagnostics[0]).toMatchObject({
      date: report.invalidBandDates[0],
      windowStartDate: expect.any(String),
      windowEndDate: expect.any(String),
      middle: expect.any(Number),
      standardDeviation: expect.any(Number),
      lower: expect.any(Number),
    });
    expect(report.invalidBandDiagnostics[0].lower).toBeLessThanOrEqual(0);
    expect(report.invalidBandDiagnostics[0].closes).toHaveLength(20);
    expect(report.bollPointCount + report.invalidBandPointCount).toBe(81);
  });
});

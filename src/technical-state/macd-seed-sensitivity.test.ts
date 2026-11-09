import { describe, expect, it } from 'vitest';
import { analyzeMacdHistoryStartSensitivity, analyzeMacdHistoryStartSensitivityAcrossPrefixes } from './macd-seed-sensitivity';
import type { ConfirmedTechnicalSeries } from './types';

function makeSeries(length = 120): ConfirmedTechnicalSeries {
  const start = new Date('2025-01-01T00:00:00.000Z');
  const bars = Array.from({ length }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const close = index < 48 ? 30 - index * 0.22 : 30 - 48 * 0.22 + (index - 48) * 0.28;
    return { date: date.toISOString().slice(0, 10), close };
  });
  return {
    interval: 'daily',
    asOfDate: bars[bars.length - 1].date,
    bars,
    source: '东方财富',
    excludedInProgressBar: false,
  };
}

describe('MACD history-start sensitivity', () => {
  it('compares suffixes ending on the same confirmed date without changing the EMA seed rule', () => {
    const series = makeSeries();
    const report = analyzeMacdHistoryStartSensitivity(series, [35, 50, 75, 100, 160]);
    expect(report.confirmedBarCount).toBe(120);
    expect(report.reference.emaSeedDate).toBe(series.bars[0].date);
    expect(report.candidates.map((candidate) => candidate.requestedBars)).toEqual([35, 50, 75, 100]);
    expect(report.candidates[0].emaSeedDate).toBe(series.bars[85].date);
    expect(report.candidates[0].preRollBars).toBe(0);
    expect(report.candidates.every((candidate) =>
      candidate.numericDeltaBpsOfClose.dif >= 0 &&
      candidate.numericDeltaBpsOfClose.dea >= 0 &&
      candidate.numericDeltaBpsOfClose.histogram >= 0,
    )).toBe(true);
    expect(report.candidates.every((candidate) =>
      candidate.state.crossEvent === 'golden' ||
      candidate.state.crossEvent === 'death' ||
      candidate.state.crossEvent === 'none',
    )).toBe(true);
  });

  it('compares seed windows at every historical as-of date without using future bars', () => {
    const series = makeSeries();
    const report = analyzeMacdHistoryStartSensitivityAcrossPrefixes(series, [35, 50, 75, 100]);
    expect(report.endpointCount).toBe(86);
    expect(report.candidates.map((candidate) => candidate.sampleCount)).toEqual([85, 70, 45, 20]);
    expect(report.candidates.every((candidate) =>
      Number.isFinite(candidate.maxNumericDeltaBpsOfClose.dif) &&
      Number.isFinite(candidate.maxNumericDeltaBpsOfClose.dea) &&
      Number.isFinite(candidate.maxNumericDeltaBpsOfClose.histogram),
    )).toBe(true);
  });

  it('rejects invalid candidate lengths and duplicate candidates', () => {
    const series = makeSeries();
    expect(() => analyzeMacdHistoryStartSensitivity(series, [34])).toThrow('大于或等于 35');
    expect(() => analyzeMacdHistoryStartSensitivity(series, [50, 50])).toThrow('不得重复');
  });

  it('rejects a history shorter than the existing 35-bar output minimum', () => {
    const series = makeSeries(34);
    expect(() => analyzeMacdHistoryStartSensitivity(series, [35])).toThrow('至少需要 35 根');
  });

  it('rejects a mismatched as-of date', () => {
    const series = { ...makeSeries(), asOfDate: '2025-01-01' };
    expect(() => analyzeMacdHistoryStartSensitivity(series, [35])).toThrow('asOfDate');
  });
});

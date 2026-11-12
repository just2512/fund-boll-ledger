import { bench, describe } from 'vitest';
import { calculateMacdFromConfirmedSeries, calculateMacdHistoryFromConfirmedSeries } from '../macd';
import { calculateBollHistory, calculateBollState } from './boll-state';
import { bollStateConfigFor } from './config';
import type { ConfirmedTechnicalSeries } from './types';

// Representative maximum-size daily history returned by the primary K-line provider.
const start = Date.UTC(2022, 0, 1);
const bars = Array.from({ length: 1000 }, (_, index) => {
  const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const close = 10 + index * 0.002 + Math.sin(index / 11) * 0.12 + Math.cos(index / 31) * 0.04;
  return { date, close };
});
const series: ConfirmedTechnicalSeries = {
  interval: 'daily',
  asOfDate: bars[bars.length - 1].date,
  bars,
  source: '东方财富',
  excludedInProgressBar: false,
};
const bollConfig = bollStateConfigFor('daily');

describe('BOLL history reuse (1000 confirmed bars)', () => {
  bench('two-pass baseline: history + independent snapshot calculation', () => {
    const history = calculateBollHistory(series, bollConfig);
    calculateBollState(series, bollConfig);
    void history;
  });

  bench('single-pass reuse: history feeds snapshot calculation', () => {
    const history = calculateBollHistory(series, bollConfig);
    calculateBollState(series, bollConfig, history);
  });
});

describe('MACD history reuse (1000 confirmed bars)', () => {
  bench('two-pass baseline: history + independent snapshot calculation', () => {
    const history = calculateMacdHistoryFromConfirmedSeries(series);
    calculateMacdFromConfirmedSeries(series);
    void history;
  });

  bench('single-pass reuse: history feeds snapshot calculation', () => {
    const history = calculateMacdHistoryFromConfirmedSeries(series);
    calculateMacdFromConfirmedSeries(series, history);
  });
});

import { bench, describe } from 'vitest';
import { calculateMacdFromConfirmedSeries, calculateMacdHistoryFromConfirmedSeries } from '../macd';
import { calculateBollHistory, calculateBollState } from './boll-state';
import { bollStateConfigFor } from './config';
import type { ConfirmedTechnicalSeries } from './types';

const HISTORY_SIZES = [240, 1000, 2000, 5000] as const;
const start = Date.UTC(2022, 0, 1);

function makeSeries(size: number): ConfirmedTechnicalSeries {
  const bars = Array.from({ length: size }, (_, index) => {
    const date = new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const close = 10 + index * 0.002 + Math.sin(index / 11) * 0.12 + Math.cos(index / 31) * 0.04;
    return { date, close };
  });
  return {
    interval: 'daily',
    asOfDate: bars[bars.length - 1].date,
    bars,
    excludedInProgressBar: false,
  };
}

const bollConfig = bollStateConfigFor('daily');

for (const size of HISTORY_SIZES) {
  const series = makeSeries(size);

  describe(`BOLL history reuse (${size} confirmed bars)`, () => {
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

  describe(`MACD history reuse (${size} confirmed bars)`, () => {
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
}

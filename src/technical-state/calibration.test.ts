import { describe, expect, it } from 'vitest';
import { summarizeDistribution } from './calibration';

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
});

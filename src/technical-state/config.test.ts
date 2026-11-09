import { describe, expect, it } from 'vitest';
import { buildBollSensitivityCandidates } from './sensitivity';
import { BOLL_STATE_CONFIG_BY_INTERVAL, BOLL_STATE_CONFIG_VERSION, bollStateConfigFor } from './config';

describe('BOLL descriptive reference configuration', () => {
  it('uses the empirically evaluated anchor candidate for each timeframe', () => {
    for (const interval of ['daily', 'weekly', 'monthly'] as const) {
      const anchor = buildBollSensitivityCandidates(interval).find((candidate) => candidate.id === 'anchor-reference-only');
      expect(anchor).toBeDefined();
      expect(bollStateConfigFor(interval)).toEqual(anchor?.config);
      expect(BOLL_STATE_CONFIG_BY_INTERVAL[interval]).toEqual(anchor?.config);
    }
  });

  it('returns a copy so callers cannot mutate the shared reference configuration', () => {
    const config = bollStateConfigFor('daily');
    config.bandwidthRankLookback = 1;
    expect(bollStateConfigFor('daily').bandwidthRankLookback).toBe(120);
    expect(BOLL_STATE_CONFIG_VERSION).toBe('reference-2026-11-09');
  });
});

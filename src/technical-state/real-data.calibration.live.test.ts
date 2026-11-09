declare const process: { env: Record<string, string | undefined> };

import { describe, expect, it } from 'vitest';
import { fetchConfirmedTechnicalHistory, fetchLatestQuote } from '../market-data';
import { calculateTechnicalStateSnapshot } from './engine';
import { calibrateBollHistory } from './calibration';
import { analyzeBollConfigSensitivity, buildBollSensitivityCandidates } from './sensitivity';
import { hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import type { BollInterval } from '../market-data';

const runLive = process.env.RUN_LIVE_TECHNICAL_CALIBRATION === '1';
const instruments = [
  { code: '510300', market: '沪市' as const },
  { code: '510500', market: '沪市' as const },
  { code: '159915', market: '深市' as const },
  { code: '512100', market: '沪市' as const },
];
const intervals: BollInterval[] = ['daily', 'weekly', 'monthly'];

describe('live multi-ETF BOLL historical calibration', () => {
  (runLive ? it : it.skip)('collects real confirmed history, checks rolling replay boundaries, and emits descriptive distributions without selecting thresholds', async () => {
    const reports = [];
    for (const instrument of instruments) {
      const request = { code: instrument.code, market: instrument.market };
      const quote = await fetchLatestQuote(request);
      for (const interval of intervals) {
        const normalized = await fetchConfirmedTechnicalHistory(request, interval, quote);
        if (normalized.validity !== 'VALID') {
          throw new Error(`${instrument.code} ${interval} 历史不可用：${normalized.reason}`);
        }
        expect(normalized.series.bars.length, `${instrument.code} ${interval} confirmed bars`).toBeGreaterThanOrEqual(35);
        const report = calibrateBollHistory(normalized.series);
        const sensitivity = analyzeBollConfigSensitivity(
          normalized.series,
          buildBollSensitivityCandidates(interval),
        );
        expect(sensitivity.thresholdSelection).toBe('NOT_PERFORMED');
        expect(sensitivity.candidates.every((candidate) => candidate.noFutureBars)).toBe(true);
        expect(report.confirmedBarCount).toBe(normalized.series.bars.length);
        expect(report.bollPointCount).toBeGreaterThan(0);

        // Run the production BOLL+MACD engine over every confirmed prefix of the
        // real provider series. Each date must see only bars available on that date.
        const replay = replayConfirmedTechnicalSeries(
          normalized.series,
          (prefix) => calculateTechnicalStateSnapshot(prefix, undefined, quote.source),
        );
        expect(replay, `${instrument.code} ${interval} replay prefix count`).toHaveLength(normalized.series.bars.length);
        expect(hasNoFutureBars(replay), `${instrument.code} ${interval} replay must not expose future bars`).toBe(true);
        expect(replay.at(-1)?.result, `${instrument.code} ${interval} final replay must match batch calculation`)
          .toEqual(calculateTechnicalStateSnapshot(normalized.series, undefined, quote.source));

        reports.push({
          code: instrument.code,
          market: instrument.market,
          klineSource: normalized.series.source,
          quoteSource: quote.source,
          excludedInProgressBar: normalized.series.excludedInProgressBar,
          parameterSensitivity: sensitivity,
          walkForward: {
            replayedPrefixCount: replay.length,
            noFutureBars: hasNoFutureBars(replay),
            finalReplayMatchesBatch: true,
          },
          ...report,
        });
      }
    }
    const sourcePolicyViolations = reports
      .filter((entry) => entry.klineSource !== '东方财富' || entry.quoteSource !== '东方财富')
      .map((entry) => ({ code: entry.code, interval: entry.interval, klineSource: entry.klineSource, quoteSource: entry.quoteSource }));
    const report = {
      schemaVersion: 4,
      sourcePolicy: {
        requiredKlineSource: '东方财富',
        requiredQuoteSource: '东方财富',
        violations: sourcePolicyViolations,
      },
      generatedAt: new Date().toISOString(),
      instruments: instruments.map(({ code }) => code),
      intervals,
      thresholdSelection: 'NOT_PERFORMED',
      replayMethod: 'CONFIRMED_PREFIX_ONE_BAR_AT_A_TIME',
      reports,
    };
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_BEGIN');
    console.info(JSON.stringify(report, null, 2));
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_END');
    expect(sourcePolicyViolations, '真实行情校准必须使用东方财富作为 K 线和现价来源；不得静默接受腾讯备用源').toEqual([]);
  }, 120_000);
});

declare const process: { env: Record<string, string | undefined> };

import { describe, expect, it } from 'vitest';
import { fetchConfirmedTechnicalHistory, fetchLatestQuote } from '../market-data';
import { calibrateBollHistory } from './calibration';
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
  (runLive ? it : it.skip)('collects real confirmed history and emits descriptive distributions without selecting thresholds', async () => {
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
        expect(report.confirmedBarCount).toBe(normalized.series.bars.length);
        expect(report.bollPointCount).toBeGreaterThan(0);
        reports.push({
          code: instrument.code,
          market: instrument.market,
          interval,
          klineSource: normalized.series.source,
          quoteSource: quote.source,
          excludedInProgressBar: normalized.series.excludedInProgressBar,
          ...report,
        });
      }
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      instruments: instruments.map(({ code }) => code),
      intervals,
      thresholdSelection: 'NOT_PERFORMED',
      reports,
    };
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_BEGIN');
    console.info(JSON.stringify(report, null, 2));
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_END');
  });
});

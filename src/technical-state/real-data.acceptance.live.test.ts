declare const process: { env: Record<string, string | undefined> };

import { describe, expect, it } from 'vitest';
import { fetchConfirmedTechnicalHistory, fetchLatestQuote } from '../market-data';
import { calculateTechnicalStateSnapshot } from './engine';
import { compareBatchWithReplay, hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import type { BollInterval } from '../market-data';

const runLive = process.env.RUN_LIVE_TECHNICAL_ACCEPTANCE === '1';

describe('live market-data technical history acceptance', () => {
  (runLive ? it : it.skip)('fetches real daily/weekly/monthly K lines and replays both indicators without look-ahead', async () => {
    const code = process.env.TECHNICAL_ACCEPTANCE_CODE?.trim() || '510300';
    const market = /^[569]/.test(code) ? '沪市' : '深市';
    const request = { code, market } as const;
    const quote = await fetchLatestQuote(request);
    const intervals: BollInterval[] = ['daily', 'weekly', 'monthly'];
    const normalized = await Promise.all(
      intervals.map((interval) => fetchConfirmedTechnicalHistory(request, interval, quote)),
    );

    const report = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index];
      const result = normalized[index];
      if (result.validity !== 'VALID') {
        throw new Error(`${interval} 历史数据不可验收：${result.reason}`);
      }
      expect(result.series.bars.length).toBeGreaterThanOrEqual(35);
      const calculate = (prefix: typeof result.series) =>
        calculateTechnicalStateSnapshot(prefix, undefined, quote.source);
      const snapshot = calculate(result.series);
      expect(snapshot.validity).toBe('VALID');
      const replay = replayConfirmedTechnicalSeries(result.series, calculate);
      expect(replay).toHaveLength(result.series.bars.length);
      expect(hasNoFutureBars(replay)).toBe(true);
      expect(compareBatchWithReplay(result.series, calculate)?.matches).toBe(true);
      report.push({
        interval,
        klineSource: result.series.source,
        quoteSource: quote.source,
        historyStartDate: snapshot.historyStartDate,
        asOfDate: snapshot.asOfDate,
        confirmedBarCount: snapshot.confirmedBarCount,
        bollBandwidthPercent: snapshot.boll.bandwidthPercent,
        macdDif: snapshot.macd.dif,
        macdDea: snapshot.macd.dea,
        macdCrossEvent: snapshot.macd.crossEvent,
      });
    }
    console.info('LIVE_TECHNICAL_ACCEPTANCE', JSON.stringify(report, null, 2));
  }, 30_000);
});

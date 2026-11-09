declare const process: { env: Record<string, string | undefined> };

import { describe, expect, it } from 'vitest';
import { fetchConfirmedTechnicalHistory, fetchLatestQuote } from '../market-data';
import { calculateTechnicalStateSnapshot } from './engine';
import { calibrateBollHistory } from './calibration';
import { auditConfirmedBollMacdSeries } from './boll-macd-events';
import { analyzeBollConfigSensitivity, buildBollSensitivityCandidates } from './sensitivity';
import { analyzeMacdHistoryStartSensitivity } from './macd-seed-sensitivity';
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
    let baiduFallbackProbe: { source: string | undefined; confirmedBars: number; eventSetupCount: number } | undefined;
    let baiduQuoteProbe: { source: string; price: string; previousClose: string; hasTrustedTradingDate: boolean } | undefined;
    for (const instrument of instruments) {
      const request = { code: instrument.code, market: instrument.market };
      const quote = await fetchLatestQuote(request);
      for (const interval of intervals) {
        const normalized = await fetchConfirmedTechnicalHistory(request, interval, quote);
        if (normalized.validity !== 'VALID') {
          throw new Error(`${instrument.code} ${interval} 历史不可用：${normalized.reason}`);
        }
        expect(normalized.series.bars.length, `${instrument.code} ${interval} confirmed bars`).toBeGreaterThanOrEqual(35);
        if (instrument.code === '510300' && interval === 'daily') {
          const originalFetch = globalThis.fetch;
          globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('push2his.eastmoney.com')) return new Response('', { status: 503 });
            return originalFetch(input, init);
          };
          try {
            const baiduHistory = await fetchConfirmedTechnicalHistory(request, interval, quote);
            if (baiduHistory.validity !== 'VALID') {
              throw new Error('百度备用 K 线实测失败：' + baiduHistory.reason);
            }
            expect(baiduHistory.series.source).toBe('百度行情');
            expect(baiduHistory.series.bars.length).toBeGreaterThanOrEqual(35);
            const baiduEvents = auditConfirmedBollMacdSeries(baiduHistory.series);
            baiduFallbackProbe = {
              source: baiduHistory.series.source,
              confirmedBars: baiduHistory.series.bars.length,
              eventSetupCount: baiduEvents.length,
            };
          } finally {
            globalThis.fetch = originalFetch;
          }
        }

        if (instrument.code === '510300' && interval === 'daily') {
          const originalFetch = globalThis.fetch;
          globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('push2.eastmoney.com/api/qt/stock/get?')) return new Response('', { status: 503 });
            return originalFetch(input, init);
          };
          try {
            const baiduQuote = await fetchLatestQuote(request);
            expect(baiduQuote.source).toBe('百度行情');
            expect(Number(baiduQuote.price)).toBeGreaterThan(0);
            expect(Number(baiduQuote.previousClose)).toBeGreaterThan(0);
            expect(baiduQuote.tradingDate).toBeUndefined();
            expect(baiduQuote.quotedAt).toBeUndefined();
            baiduQuoteProbe = {
              source: baiduQuote.source,
              price: baiduQuote.price,
              previousClose: baiduQuote.previousClose,
              hasTrustedTradingDate: baiduQuote.tradingDate !== undefined,
            };
          } finally {
            globalThis.fetch = originalFetch;
          }
        }

        const report = calibrateBollHistory(normalized.series);
        const bollMacdEvents = auditConfirmedBollMacdSeries(normalized.series);
        const confirmedEvents = bollMacdEvents.filter((event) => event.status === 'confirmed');
        expect(confirmedEvents.every((event) =>
          event.confirmationDate !== undefined && event.confirmationDate > event.triggerDate &&
          event.barsToCross !== undefined && event.barsToCross > 0 &&
          Number.isFinite(event.closeChangePercent),
        )).toBe(true);
        const sensitivity = analyzeBollConfigSensitivity(
          normalized.series,
          buildBollSensitivityCandidates(interval),
        );
        const macdSeedSensitivity = analyzeMacdHistoryStartSensitivity(
          normalized.series,
          [35, 50, 75, 100, 160, 240],
        );
        expect(sensitivity.thresholdSelection).toBe('NOT_PERFORMED');
        expect(sensitivity.candidates.every((candidate) => candidate.noFutureBars)).toBe(true);
        expect(macdSeedSensitivity.candidates.every((candidate) => candidate.barsUsed === candidate.requestedBars)).toBe(true);
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
          macdSeedSensitivity,
          bollMacdEventAudit: {
            setupCount: bollMacdEvents.length,
            confirmedCount: confirmedEvents.length,
            invalidatedCount: bollMacdEvents.filter((event) => event.status === 'invalidated').length,
            pendingCount: bollMacdEvents.filter((event) => event.status === 'pending').length,
            setups: bollMacdEvents,
          },
          walkForward: {
            replayedPrefixCount: replay.length,
            noFutureBars: hasNoFutureBars(replay),
            finalReplayMatchesBatch: true,
          },
          ...report,
        });
      }
    }
    expect(baiduFallbackProbe?.source, '必须真实请求百度备用 K 线并确认其可用，不能只用 fixture 证明解析器').toBe('百度行情');
    expect(baiduQuoteProbe?.source, '必须真实请求百度备用现价并确认昨收解析，不得回退腾讯').toBe('百度行情');
    const sourcePolicyViolations = reports
      .filter((entry) => !['东方财富', '百度行情'].includes(entry.klineSource ?? '') || entry.quoteSource !== '东方财富')
      .map((entry) => ({ code: entry.code, interval: entry.interval, klineSource: entry.klineSource, quoteSource: entry.quoteSource }));
    const report = {
      schemaVersion: 4,
      sourcePolicy: {
        requiredKlineSources: ['东方财富', '百度行情'],
        requiredQuoteSource: '东方财富',
        violations: sourcePolicyViolations,
      },
      generatedAt: new Date().toISOString(),
      instruments: instruments.map(({ code }) => code),
      intervals,
      thresholdSelection: 'NOT_PERFORMED',
      replayMethod: 'CONFIRMED_PREFIX_ONE_BAR_AT_A_TIME',
      baiduFallbackProbe,
      baiduQuoteProbe,
      reports,
    };
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_BEGIN');
    console.info(JSON.stringify(report, null, 2));
    console.info('LIVE_TECHNICAL_CALIBRATION_JSON_END');
    expect(sourcePolicyViolations, '真实行情校准只允许东方财富主源或百度 K 线备用源；现价必须来自东方财富，不得静默接受腾讯数据').toEqual([]);
  }, 120_000);
});

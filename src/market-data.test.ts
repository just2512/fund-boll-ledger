import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBollBands, fetchConfirmedTechnicalHistory, fetchLatestMarketData, fetchLatestQuote } from './market-data';

afterEach(() => vi.unstubAllGlobals());

function marketTime(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}
// Real Eastmoney f86 is a Unix-seconds epoch (10 digits), as observed live on 2026-10-19.
function marketEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
function dateIso(date: Date): string {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function dailyCloses(): string[] {
  const now = new Date();
  return Array.from({ length: 25 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (24 - index));
    return dateIso(date) + ',' + (4 + index * 0.001).toFixed(3);
  });
}
function intervalCloses(interval: 'daily' | 'weekly' | 'monthly'): string[] {
  const now = new Date();
  let dates: string[];
  if (interval === 'daily') {
    dates = Array.from({ length: 50 }, (_, index) => { const date = new Date(now); date.setDate(now.getDate() - (49 - index)); return dateIso(date); });
  } else if (interval === 'weekly') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    dates = Array.from({ length: 20 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() - (19 - index) * 7); return dateIso(date); });
  } else {
    dates = Array.from({ length: 20 }, (_, index) => dateIso(new Date(now.getFullYear(), now.getMonth() - (19 - index), 1)));
  }
  return dates.map((date, index) => [date, (4 + index * 0.001).toFixed(3), (4 + index * 0.001).toFixed(3), (4 + index * 0.001).toFixed(3), (4 + index * 0.001).toFixed(3), '0', '0', '0', '0', '0', '0'].join(','));
}
function eastmoneyResponse(data: Record<string, unknown> | null): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('manual ETF market quote refresh', () => {
  it('uses Eastmoney first and derives daily change from the same quote snapshot', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime(),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('secid=1.510300');
    expect(quote.source).toBe('东方财富');
    expect(quote.price).toBe('4.125');
    expect(quote.previousClose).toBe('4.000');
    expect(quote.changePercent).toBe(3.13);
    expect(quote.quotedAt).toBeTruthy();
  });
  it('parses the real Eastmoney f86 Unix-seconds epoch into a Beijing-time quote stamp', async () => {
    const epoch = marketEpochSeconds();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: epoch,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(quote.quotedAt).toContain('（北京时间）');
    expect(quote.quotedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）$/);
    expect(quote.tradingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The epoch's Shanghai date must be the trading date actually used for BOLL recalculation.
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch * 1000));
    expect(quote.tradingDate).toBe(parts.split('/').reverse().join('-'));
  });
  it('rejects implausible epoch values instead of showing a bogus quote time', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: 12345678901234,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(quote.quotedAt).toBeUndefined();
    expect(quote.tradingDate).toBeUndefined();
  });
  it('prefers epoch over a coincidental calendar reading for 10-digit f86 values', async () => {
    // 2035010100: as a calendar yyyymmddhh it would read 2035-01-01 (plausible!), but the
    // epoch interpretation is the real one; epoch must win so no ghost trading date is forged.
    const epoch = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: epoch,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch * 1000));
    expect(quote.tradingDate).toBe(parts.split('/').reverse().join('-'));
  });
  it('falls back to Baidu for quote price and previous close without inventing a source timestamp', async () => {
    const baidu = new Response(JSON.stringify({
      ResultCode: 0,
      Result: {
        code: '510300',
        name: '沪深300ETF',
        cur: { price: '4.125', increase: '+0.125', ratio: '+3.13%' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse(null)).mockResolvedValueOnce(baidu);
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/vapi/v1/getquotation?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('financeType=etf');
    expect(quote.source).toBe('百度行情');
    expect(quote.name).toBe('沪深300ETF');
    expect(quote.price).toBe('4.125');
    expect(quote.previousClose).toBe('4.000');
    expect(quote.changePercent).toBe(3.13);
    expect(quote.quotedAt).toBeUndefined();
    expect(quote.tradingDate).toBeUndefined();
  });
  it('does not calculate live BOLL from a Baidu quote without a trusted trading date', async () => {
    const baidu = new Response(JSON.stringify({
      ResultCode: 0,
      Result: { code: '510300', cur: { price: '4.125', increase: '+0.125', ratio: '+3.13%' } },
    }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('push2.eastmoney.com/api/qt/stock/get?')) return eastmoneyResponse(null);
      if (url.includes('/vapi/v1/getquotation?')) return baidu.clone();
      if (url.includes('push2his.eastmoney.com')) {
        const period = url.includes('klt=102') ? 'weekly' : url.includes('klt=103') ? 'monthly' : 'daily';
        const klines = intervalCloses(period).map((line) => { const [date, close] = line.split(','); return [date, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(','); });
        return eastmoneyResponse({ code: '510300', klines });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(market.source).toBe('百度行情');
    expect(market.tradingDate).toBeUndefined();
    expect(market.boll).toBeUndefined();
    expect(market.bollError).toContain('可信交易日期');
    expect(market.technicalState?.daily.validity).toBe('INVALID');
    expect(market.technicalState?.daily.reason).toContain('交易日期');
  });
  it('integrates confirmed BOLL and MACD states for daily, weekly, and monthly histories', async () => {
    const epoch = marketEpochSeconds();
    const tradingDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(epoch * 1000));
    const expectedBars = { daily: 220, weekly: 180, monthly: 120 } as const;
    const buildDates = (interval: 'daily' | 'weekly' | 'monthly'): string[] => {
      let cursor = new Date(tradingDate + 'T00:00:00.000Z');
      if (interval === 'daily') {
        const dates: string[] = [];
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        while (dates.length < expectedBars.daily) {
          const day = cursor.getUTCDay();
          if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
        return dates.reverse();
      }
      if (interval === 'weekly') {
        cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7) - 7);
        cursor.setUTCDate(cursor.getUTCDate() - (expectedBars.weekly - 1) * 7);
      }
      if (interval === 'monthly') {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - expectedBars.monthly, 1));
      }
      return Array.from({ length: expectedBars[interval] }, (_, index) => {
        const date = new Date(cursor);
        if (interval === 'weekly') date.setUTCDate(date.getUTCDate() + index * 7);
        if (interval === 'monthly') date.setUTCMonth(date.getUTCMonth() + index);
        return date.toISOString().slice(0, 10);
      });
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('push2.eastmoney.com/api/qt/stock/get?')) {
        return eastmoneyResponse({
          f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: epoch,
        });
      }
      if (url.includes('push2his.eastmoney.com/api/qt/stock/kline/get?')) {
        const params = new URL(url).searchParams;
        const interval = params.get('klt') === '102' ? 'weekly'
          : params.get('klt') === '103' ? 'monthly' : 'daily';
        const klines = buildDates(interval).map((date, index) => {
          const close = (4 + index * 0.002 + Math.sin(index / 4) * 0.02).toFixed(3);
          return [date, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',');
        });
        return eastmoneyResponse({ code: '510300', klines });
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(market.source).toBe('东方财富');
    expect(market.technicalState?.daily.validity).toBe('VALID');
    expect(market.technicalState?.weekly.validity).toBe('VALID');
    expect(market.technicalState?.monthly.validity).toBe('VALID');
    for (const state of [
      market.technicalState?.daily,
      market.technicalState?.weekly,
      market.technicalState?.monthly,
    ]) {
      expect(state?.source).toBe('东方财富');
      expect(state?.quoteSource).toBe('东方财富');
      expect(state?.confirmedBarCount).toBe(expectedBars[state!.interval]);
      expect(state?.macd.error).toBeUndefined();
      expect(state?.boll.validity).toBe('VALID');
    }
    expect(market.boll).toBeDefined();
    expect(market.weeklyBollRange).toBeDefined();
    expect(market.monthlyBollRange).toBeDefined();
  });

  it('rejects invalid fund codes without making network requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLatestQuote({ code: '51030', market: '沪市' })).rejects.toThrow('6 位');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails clearly if both live quote sources are unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('invalid response', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // Both sources' own failure reasons must survive into the final message.
    await expect(fetchLatestQuote({ code: '510300', market: '沪市' })).rejects.toThrow('东方财富失败：行情服务返回 HTTP 503；百度失败：百度行情现价返回内容不是有效 JSON');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('BOLL(20,2)', () => {
  it('uses the mean and population standard deviation of the latest 20 closes', () => {
    const closes = Array.from({ length: 20 }, (_, index) => ({ date: '2026-01-' + String(index + 1).padStart(2, '0'), close: '10' }));
    closes[19] = { date: '2026-01-20', close: '12' };
    const bands = calculateBollBands(closes);
    expect(bands.middle).toBe('10.100');
    expect(bands.upper).toBe('10.972');
    expect(bands.lower).toBe('9.228');
    expect(bands.period).toBe(20);
    expect(bands.standardDeviations).toBe(2);
  });
  it('rounds refreshed BOLL rail prices half-up to exactly three decimal places', () => {
    const closes = Array.from({ length: 20 }, (_, index) => ({ date: '2026-01-' + String(index + 1).padStart(2, '0'), close: '1.2345' }));
    const bands = calculateBollBands(closes);
    expect(bands.upper).toBe('1.235');
    expect(bands.middle).toBe('1.235');
    expect(bands.lower).toBe('1.235');
  });
  it('uses the refreshed current price for active weekly and monthly candles by period key', () => {
    const now = new Date();
    const tradingDate = dateIso(now);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekly = Array.from({ length: 20 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() - (19 - index) * 7); return { date: dateIso(date), close: '9.000' }; });
    const monthly = Array.from({ length: 20 }, (_, index) => ({ date: dateIso(new Date(now.getFullYear(), now.getMonth() - (19 - index), 1)), close: '9.000' }));
    const weeklyBands = calculateBollBands(weekly, '10.000', tradingDate, 'weekly');
    const monthlyBands = calculateBollBands(monthly, '10.000', tradingDate, 'monthly');
    expect(weeklyBands.currentPriceApplied).toBe(true);
    expect(monthlyBands.currentPriceApplied).toBe(true);
    expect(Number(weeklyBands.upper)).toBeGreaterThan(Number(weeklyBands.lower));
    expect(Number(monthlyBands.upper)).toBeGreaterThan(Number(monthlyBands.lower));
  });
  it('uses the refreshed current price as the current-day close when the date matches', () => {
    const closes = dailyCloses().map((line) => {
      const [date, close] = line.split(',');
      return { date, close };
    });
    const lastDate = closes[closes.length - 1].date;
    const bands = calculateBollBands(closes, '4.125', lastDate);
    expect(bands.currentPriceApplied).toBe(true);
    expect(bands.tradingDate).toBe(lastDate);
    expect(Number(bands.middle)).toBeGreaterThan(4.0);
  });
  it('loads daily, weekly, and monthly bars and calculates separate BOLL(20,2) bands', async () => {
    const barSet = (interval: 'daily' | 'weekly' | 'monthly') => intervalCloses(interval).map((line) => { const [date, close] = line.split(','); return [date, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(','); });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime() }))
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', klines: barSet('daily') }))
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', klines: barSet('weekly') }))
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', klines: barSet('monthly') }));
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1][0])).toContain('push2his.eastmoney.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('fqt=0');
    expect(String(fetchMock.mock.calls[1][0])).toContain('klt=101');
    expect(String(fetchMock.mock.calls[2][0])).toContain('klt=102');
    expect(String(fetchMock.mock.calls[3][0])).toContain('klt=103');
    expect(market.price).toBe('4.125');
    expect(market.previousClose).toBe('4.000');
    expect(market.boll?.period).toBe(20);
    expect(market.macd).toBeDefined();
    expect(market.macd?.daily.interval).toBe('daily');
    expect(market.technicalState?.daily.source).toBe('东方财富');
    expect(market.technicalState?.daily.quoteSource).toBe('东方财富');
    expect(market.technicalState?.daily.boll.asOfDate).toBe(market.technicalState?.daily.macd.asOfDate);
    expect(market.technicalState?.daily.confirmedBarCount).toBeGreaterThanOrEqual(20);
    expect(market.technicalState?.daily.historyStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(market.technicalState?.weekly.boll.validity).toBe('INSUFFICIENT');
    expect(market.technicalState?.monthly.boll.validity).toBe('INSUFFICIENT');
    expect(market.weeklyBollRange).toEqual({ upper: expect.any(String), lower: expect.any(String) });
    expect(market.monthlyBollRange).toEqual({ upper: expect.any(String), lower: expect.any(String) });
    expect(market.boll?.upper).toMatch(/^\d+\.\d{3}$/);
    expect(market.weeklyBollRange).toBeDefined();
    expect(market.monthlyBollRange).toBeDefined();
  });
  it('preserves the Eastmoney quote and falls back to Baidu K lines when Eastmoney history fails', async () => {
    const baiduKline = (interval: 'daily' | 'weekly' | 'monthly') => {
      const rows = intervalCloses(interval).map((line) => {
        const [date, close] = line.split(',');
        return [date, close, close, close, close, '1000', '1000'].join(',');
      });
      return new Response(JSON.stringify({
        ResultCode: 0,
        Result: {
          newMarketData: {
            keys: ['time', 'open', 'close', 'high', 'low', 'volume', 'amount'],
            marketData: rows.join(';'),
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('push2.eastmoney.com/api/qt/stock/get?')) {
        return eastmoneyResponse({ f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime() });
      }
      if (url.includes('push2his.eastmoney.com')) return new Response('', { status: 503 });
      if (url.includes('finance.pae.baidu.com/selfselect/getstockquotation')) {
        const eprop = new URL(url).searchParams.get('eprop');
        const interval = eprop === 'weekK' ? 'weekly' : eprop === 'monthK' ? 'monthly' : 'daily';
        return baiduKline(interval);
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(market.price).toBe('4.125');
    expect(market.technicalState?.daily.source).toBe('百度行情');
    expect(market.technicalState?.daily.quoteSource).toBe('东方财富');
    expect(market.technicalState?.weekly.source).toBe('百度行情');
    expect(market.technicalState?.monthly.source).toBe('百度行情');
    expect(market.boll?.middle).toMatch(/^\d+\.\d{3}$/);
    expect(market.weeklyBollRange).toEqual({ upper: expect.any(String), lower: expect.any(String) });
    expect(market.monthlyBollRange).toEqual({ upper: expect.any(String), lower: expect.any(String) });
    const baiduCall = fetchMock.mock.calls.find(([input]) => String(input).includes('finance.pae.baidu.com'));
    expect(baiduCall).toBeDefined();
    expect(baiduCall?.[1]?.headers).toMatchObject({
      Accept: 'application/vnd.finance-web.v1+json',
      Referer: 'https://finance.baidu.com/',
    });
  });
  it('fails closed when both Eastmoney and Baidu K-line sources are unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime() }))
      .mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(market.price).toBe('4.125');
    expect(market.boll).toBeUndefined();
    expect(market.weeklyBollRange).toBeUndefined();
    expect(market.monthlyBollRange).toBeUndefined();
    expect(market.bollError).toContain('东方财富失败');
    expect(market.bollError).toContain('百度失败');
    expect(market.weeklyBollRangeError).toContain('百度失败');
    expect(market.monthlyBollRangeError).toContain('百度失败');
    expect(market.technicalState?.daily.validity).toBe('INVALID');
    expect(market.technicalState?.daily.reason).toContain('东方财富失败');
    expect(market.technicalState?.daily.reason).toContain('百度失败');
    expect(market.technicalState?.daily.quoteSource).toBe('东方财富');
  });
});


describe('extended confirmed market history', () => {
  const quoteForHistory = () => {
    const today = new Date();
    return {
      code: '510300',
      price: '4.125',
      previousClose: '4.000',
      changePercent: 3.13,
      source: '东方财富' as const,
      tradingDate: dateIso(today),
      fetchedAt: today.toISOString(),
    };
  };

  const extendedRows = () => {
    const today = new Date();
    return Array.from({ length: 400 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - 400 + index);
      return { date: dateIso(date), close: (4 + index * 0.0001).toFixed(4) };
    });
  };

  it('requests up to 1000 Eastmoney bars and retains more than the former 320-bar cap', async () => {
    const rows = extendedRows();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      code: '510300',
      klines: rows.map(({ date, close }) => [date, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',')),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchConfirmedTechnicalHistory(
      { code: '510300', market: '沪市' },
      'daily',
      quoteForHistory(),
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('lmt=1000');
    expect(result.validity).toBe('VALID');
    if (result.validity === 'VALID') expect(result.series.bars).toHaveLength(400);
  });

  it('retains more than 320 Baidu bars after Eastmoney history failure', async () => {
    const rows = extendedRows();
    const payload = {
      ResultCode: 0,
      Result: {
        newMarketData: {
          keys: ['time', 'open', 'close', 'high', 'low', 'volume', 'amount'],
          marketData: rows.map(({ date, close }) => [date, close, close, close, close, '1000', '1000'].join(',')).join(';'),
        },
      },
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchConfirmedTechnicalHistory(
      { code: '510300', market: '沪市' },
      'daily',
      quoteForHistory(),
    );
    expect(result.validity).toBe('VALID');
    if (result.validity === 'VALID') {
      expect(result.series.source).toBe('百度行情');
      expect(result.series.bars).toHaveLength(400);
    }
  });
});

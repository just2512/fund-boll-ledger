import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBollBands, fetchLatestMarketData, fetchLatestQuote } from './market-data';

afterEach(() => vi.unstubAllGlobals());

function marketTime(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
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
function eastmoneyResponse(data: Record<string, unknown> | null): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function tencentResponse(code = '510300'): Response {
  const fields = Array.from({ length: 50 }, () => '');
  fields[0] = '1'; fields[1] = '沪深300ETF'; fields[2] = code; fields[3] = '4.125'; fields[4] = '4.000';
  fields[30] = marketTime(); fields[32] = '3.13';
  return new Response('v_sh' + code + '="' + fields.join('~') + '";', { status: 200, headers: { 'Content-Type': 'text/plain; charset=GBK' } });
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
    expect(quote.previousClose).toBe('4');
    expect(quote.changePercent).toBe(3.13);
    expect(quote.quotedAt).toBeTruthy();
  });
  it('falls back to Tencent when Eastmoney returns no valid row', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse(null)).mockResolvedValueOnce(tencentResponse());
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('qt.gtimg.cn/q=sh510300');
    expect(quote.source).toBe('腾讯行情');
    expect(quote.price).toBe('4.125');
    expect(quote.changePercent).toBe(3.13);
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
    await expect(fetchLatestQuote({ code: '510300', market: '沪市' })).rejects.toThrow('东方财富未返回有效行情');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('BOLL(20,2)', () => {
  it('uses the mean and population standard deviation of the latest 20 closes', () => {
    const closes = Array.from({ length: 20 }, (_, index) => ({ date: '2026-01-' + String(index + 1).padStart(2, '0'), close: '10' }));
    closes[19] = { date: '2026-01-20', close: '12' };
    const bands = calculateBollBands(closes);
    expect(bands.middle).toBe('10.1');
    expect(Number(bands.upper)).toBeCloseTo(10.97178, 4);
    expect(Number(bands.lower)).toBeCloseTo(9.22822, 4);
    expect(bands.period).toBe(20);
    expect(bands.standardDeviations).toBe(2);
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
  it('loads daily bars after a quote and calculates BOLL(20,2)', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime() }))
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', klines: dailyCloses() }));
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('push2his.eastmoney.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('fqt=0');
    expect(market.price).toBe('4.125');
    expect(market.previousClose).toBe('4');
    expect(market.boll).toBeDefined();
    expect(market.boll?.period).toBe(20);
  });
  it('preserves a valid quote if historical daily bars fail', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eastmoneyResponse({ code: '510300', f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: marketTime() }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const market = await fetchLatestMarketData({ code: '510300', market: '沪市' });
    expect(market.price).toBe('4.125');
    expect(market.boll).toBeUndefined();
    expect(market.bollError).toContain('HTTP 503');
  });
});

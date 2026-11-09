import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateBollBands, fetchLatestMarketData, fetchLatestQuote } from './market-data';

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
  it('keeps a 6-digit hhmmss stamp dateless so no ghost trading date is forged', async () => {
    const fields = Array.from({ length: 50 }, () => '');
    fields[0] = '1'; fields[1] = '沪深300ETF'; fields[2] = '510300'; fields[3] = '4.125'; fields[4] = '4.000';
    fields[30] = '150030'; fields[32] = '3.13';
    const tencent = new Response('v_sh510300="' + fields.join('~') + '";', { status: 200, headers: { 'Content-Type': 'text/plain; charset=GBK' } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse(null)).mockResolvedValueOnce(tencent);
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(quote.quotedAt).toBe('15:00:30（北京时间）');
    // Dateless stamps must never be stamped with today: a weekend refresh must not
    // inject a ghost non-trading-day bar into the BOLL window.
    expect(quote.tradingDate).toBeUndefined();
  });
  it('decodes GBK Tencent payloads so multi-byte names cannot forge the ~ separator', async () => {
    // GBK 0x5526 (唦) encodes to 0x86 0x7E: its second byte equals the '~' separator byte.
    // The mock must therefore serve REAL GBK bytes; decoding them atomically keeps field
    // alignment intact, while a naive UTF-8 text() read would split the name and shift fields.
    const fields = Array.from({ length: 50 }, () => '');
    fields[0] = '1'; fields[1] = '唦深300ETF'; fields[2] = '510300'; fields[3] = '4.125'; fields[4] = '4.000';
    fields[30] = marketTime(); fields[32] = '3.13';
    const textPart = 'v_sh510300="' + fields.join('~') + '";';
    // Rebuild the byte stream with GBK encoding for the CJK name field:
    // 唦 -> 0x86 0x7E (second byte == '~' 0x7E), 深 -> 0xC9 0xEE.
    const nameStart = textPart.indexOf('唦深300ETF');
    const gbkBytes: number[] = [];
    for (const ch of textPart.slice(0, nameStart)) gbkBytes.push(ch.charCodeAt(0));
    gbkBytes.push(0x86, 0x7e, 0xc9, 0xee);
    for (const ch of '300ETF') gbkBytes.push(ch.charCodeAt(0));
    for (const ch of textPart.slice(nameStart + '唦深300ETF'.length)) gbkBytes.push(ch.charCodeAt(0));
    const tencentGbk = new Response(new Uint8Array(gbkBytes).buffer, { status: 200, headers: { 'Content-Type': 'text/html; charset=GBK' } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse(null)).mockResolvedValueOnce(tencentGbk);
    vi.stubGlobal('fetch', fetchMock);
    const quote = await fetchLatestQuote({ code: '510300', market: '沪市' });
    expect(quote.source).toBe('腾讯行情');
    expect(quote.name).toBe('唦深300ETF');
    expect(quote.price).toBe('4.125');
    expect(quote.changePercent).toBe(3.13);
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
    // Both sources' own failure reasons must survive into the final message.
    await expect(fetchLatestQuote({ code: '510300', market: '沪市' })).rejects.toThrow('东方财富失败：行情服务返回 HTTP 503；腾讯失败：腾讯行情返回格式无法识别');
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

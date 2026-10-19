import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestQuote } from './market-data';

afterEach(() => {
  vi.unstubAllGlobals();
});

function marketTime(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}

function eastmoneyResponse(data: Record<string, unknown> | null): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tencentResponse(code = '510300'): Response {
  const fields = Array.from({ length: 50 }, () => '');
  fields[0] = '1';
  fields[1] = '沪深300ETF';
  fields[2] = code;
  fields[3] = '4.125';
  fields[4] = '4.000';
  fields[30] = marketTime();
  fields[32] = '3.13';
  return new Response('v_sh' + code + '="' + fields.join('~') + '";', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=GBK' },
  });
}

describe('manual ETF market quote refresh', () => {
  it('uses Eastmoney first and derives daily change from the same quote snapshot', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(eastmoneyResponse({
      f57: '510300',
      f58: '沪深300ETF',
      f43: '4.125',
      f60: '4.000',
      f86: marketTime(),
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
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eastmoneyResponse(null))
      .mockResolvedValueOnce(tencentResponse());
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

  it('fails clearly if both sources are unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('invalid response', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLatestQuote({ code: '510300', market: '沪市' })).rejects.toThrow('东方财富未返回有效行情');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

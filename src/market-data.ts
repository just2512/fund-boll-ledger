export type QuoteSource = '东方财富' | '腾讯行情';

export interface MarketQuote {
  code: string;
  name?: string;
  price: string;
  previousClose: string;
  changePercent: number;
  source: QuoteSource;
  quotedAt?: string;
  fetchedAt: string;
}

export interface MarketQuoteRequest {
  code: string;
  market: '沪市' | '深市' | '其他/未确认';
}

const REQUEST_TIMEOUT_MS = 3500;

function parsePositiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('行情字段无效：' + field);
  return parsed;
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function roundPercent(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 100 + Number.EPSILON) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function marketPrefix(code: string, market: MarketQuoteRequest['market']): 'sh' | 'sz' {
  if (market === '沪市') return 'sh';
  if (market === '深市') return 'sz';
  return /^[569]/.test(code) ? 'sh' : 'sz';
}

function eastmoneyMarket(code: string, market: MarketQuoteRequest['market']): '0' | '1' {
  return marketPrefix(code, market) === 'sh' ? '1' : '0';
}

function parseMarketTime(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const digits = String(value).trim().replace(/\D/g, '');
  let year: number;
  let month: number;
  let day: number;
  let hour = 15;
  let minute = 0;
  let second = 0;
  let dateOnly = false;

  if (digits.length >= 14) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    hour = Number(digits.slice(8, 10));
    minute = Number(digits.slice(10, 12));
    second = Number(digits.slice(12, 14));
  } else if (digits.length === 12) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    hour = Number(digits.slice(8, 10));
    minute = Number(digits.slice(10, 12));
  } else if (digits.length === 8) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    dateOnly = true;
  } else if (digits.length === 6) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
    day = now.getDate();
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2, 4));
    second = Number(digits.slice(4, 6));
  } else {
    return undefined;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(date.getTime())) return undefined;
  return dateOnly ? date.toLocaleDateString('zh-CN') : date.toLocaleString('zh-CN', { hour12: false });
}

async function requestText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('行情服务返回 HTTP ' + response.status);
    return await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('行情请求超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createQuote(
  code: string,
  name: string | undefined,
  priceValue: unknown,
  closeValue: unknown,
  timeValue: unknown,
  source: QuoteSource,
): MarketQuote {
  const price = parsePositiveNumber(priceValue, '最新价');
  const previousClose = parsePositiveNumber(closeValue, '昨日收盘价');
  const changePercent = roundPercent(((price - previousClose) / previousClose) * 100);
  const now = new Date();
  return {
    code,
    name,
    price: formatPrice(price),
    previousClose: formatPrice(previousClose),
    changePercent,
    source,
    quotedAt: parseMarketTime(timeValue),
    fetchedAt: now.toLocaleString('zh-CN', { hour12: false }),
  };
}

async function fetchEastmoneyQuote(code: string, market: MarketQuoteRequest['market']): Promise<MarketQuote> {
  const secid = eastmoneyMarket(code, market) + '.' + code;
  const params = new URLSearchParams({
    secid,
    fields: 'f43,f57,f58,f60,f86',
    fltt: '2',
    invt: '2',
    _: String(Date.now()),
  });
  const raw = await requestText('https://push2.eastmoney.com/api/qt/stock/get?' + params.toString());
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('东方财富返回内容不是有效 JSON');
  }
  if (!payload || typeof payload !== 'object') throw new Error('东方财富未返回行情对象');
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error('东方财富未返回该基金行情');
  const row = data as Record<string, unknown>;
  if (String(row.f57 ?? '').trim() !== code) throw new Error('东方财富返回代码与当前基金不一致');
  const name = typeof row.f58 === 'string' && row.f58.trim() ? row.f58.trim() : undefined;
  return createQuote(code, name, row.f43, row.f60, row.f86, '东方财富');
}

async function fetchTencentQuote(code: string, market: MarketQuoteRequest['market']): Promise<MarketQuote> {
  const symbol = marketPrefix(code, market) + code;
  const raw = await requestText('https://qt.gtimg.cn/q=' + symbol + '&_=' + String(Date.now()));
  const match = raw.match(/=\s*"([\s\S]*?)"\s*;/);
  if (!match) throw new Error('腾讯行情返回格式无法识别');
  const fields = match[1].split('~');
  if (String(fields[2] ?? '').trim() !== code) throw new Error('腾讯行情返回代码与当前基金不一致');
  if (fields.length < 33) throw new Error('腾讯行情字段不完整');
  const name = fields[1]?.trim() || undefined;
  return createQuote(code, name, fields[3], fields[4], fields[30], '腾讯行情');
}

export async function fetchLatestQuote(request: MarketQuoteRequest): Promise<MarketQuote> {
  const code = request.code.trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请先在基金档案中填写有效的 6 位场内基金代码。');

  try {
    return await fetchEastmoneyQuote(code, request.market);
  } catch {
    try {
      return await fetchTencentQuote(code, request.market);
    } catch {
      throw new Error('东方财富未返回有效行情，腾讯行情也未返回有效报价。请检查基金代码或网络连接。');
    }
  }
}

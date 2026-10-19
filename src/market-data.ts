export type QuoteSource = '东方财富' | '腾讯行情';

export interface BollBands {
  upper: string;
  middle: string;
  lower: string;
  period: 20;
  standardDeviations: 2;
  tradingDate: string;
  currentPriceApplied: boolean;
}

export interface DailyClose {
  date: string;
  close: string | number;
}

export interface MarketQuote {
  code: string;
  name?: string;
  price: string;
  previousClose: string;
  changePercent: number;
  source: QuoteSource;
  quotedAt?: string;
  tradingDate?: string;
  fetchedAt: string;
  boll?: BollBands;
  bollError?: string;
}

export interface MarketQuoteRequest {
  code: string;
  market: '沪市' | '深市' | '其他/未确认';
}

const REQUEST_TIMEOUT_MS = 3500;
const BOLL_PERIOD = 20;
const BOLL_STANDARD_DEVIATIONS = 2;

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
  if (!Number.isFinite(value) || value <= 0) throw new Error('计算出的价格无效');
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

function shanghaiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

function tradingDateFrom(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const digits = String(value).trim().replace(/\D/g, '');
  if (digits.length >= 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    if (Number(year) < 2000 || Number(year) > 2100 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return undefined;
    return year + '-' + month + '-' + day;
  }
  if (digits.length === 6) return shanghaiDate();
  return undefined;
}

function parseMarketTime(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const digits = String(value).trim().replace(/\D/g, '');
  let date = '';
  let time = '';

  if (digits.length >= 14 || digits.length === 12 || digits.length === 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    if (Number(year) < 2000 || Number(year) > 2100 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return undefined;
    date = year + '-' + month + '-' + day;
    if (digits.length >= 14) time = digits.slice(8, 10) + ':' + digits.slice(10, 12) + ':' + digits.slice(12, 14);
    else if (digits.length === 12) time = digits.slice(8, 10) + ':' + digits.slice(10, 12);
  } else if (digits.length === 6) {
    date = shanghaiDate();
    time = digits.slice(0, 2) + ':' + digits.slice(2, 4) + ':' + digits.slice(4, 6);
  } else {
    return undefined;
  }

  if (time) {
    const [hour, minute, second = '0'] = time.split(':').map(Number);
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    return date + ' ' + time + '（北京时间）';
  }
  return date + '（北京时间）';
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
  const now = new Date();
  return {
    code,
    name,
    price: formatPrice(price),
    previousClose: formatPrice(previousClose),
    changePercent: roundPercent(((price - previousClose) / previousClose) * 100),
    source,
    quotedAt: parseMarketTime(timeValue),
    tradingDate: tradingDateFrom(timeValue),
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

export function calculateBollBands(
  dailyCloses: DailyClose[],
  latestPrice?: string,
  latestPriceDate?: string,
): BollBands {
  const byDate = new Map<string, number>();
  for (const row of dailyCloses) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    try {
      byDate.set(row.date, parsePositiveNumber(row.close, '日线收盘价'));
    } catch {
      // Ignore malformed bars; a minimum valid history is checked below.
    }
  }
  const ordered = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
  let currentPriceApplied = false;
  if (latestPrice && latestPriceDate) {
    try {
      const value = parsePositiveNumber(latestPrice, '最新价');
      const last = ordered.at(-1);
      if (last?.date === latestPriceDate) {
        last.close = value;
        currentPriceApplied = true;
      } else if (last && latestPriceDate > last.date) {
        ordered.push({ date: latestPriceDate, close: value });
        currentPriceApplied = true;
      }
    } catch {
      // Keep raw daily bars when the quote is malformed.
    }
  }
  if (ordered.length < BOLL_PERIOD) throw new Error('历史日线不足 20 个交易日，暂时无法计算 BOLL(20,2)。');

  const windowCloses = ordered.slice(-BOLL_PERIOD).map((row) => row.close);
  const middle = windowCloses.reduce((sum, value) => sum + value, 0) / BOLL_PERIOD;
  const variance = windowCloses.reduce((sum, value) => sum + (value - middle) ** 2, 0) / BOLL_PERIOD;
  const standardDeviation = Math.sqrt(variance);
  return {
    upper: formatPrice(middle + BOLL_STANDARD_DEVIATIONS * standardDeviation),
    middle: formatPrice(middle),
    lower: formatPrice(middle - BOLL_STANDARD_DEVIATIONS * standardDeviation),
    period: 20,
    standardDeviations: 2,
    tradingDate: ordered[ordered.length - 1].date,
    currentPriceApplied,
  };
}

async function fetchEastmoneyBollBands(
  code: string,
  market: MarketQuoteRequest['market'],
  quote: MarketQuote,
): Promise<BollBands> {
  const secid = eastmoneyMarket(code, market) + '.' + code;
  const params = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    ut: 'fa5fd1943c7b386f172d6893dbbd1d0c',
    klt: '101',
    fqt: '0',
    end: '20500101',
    lmt: '40',
    _: String(Date.now()),
  });
  const raw = await requestText('https://push2his.eastmoney.com/api/qt/stock/kline/get?' + params.toString());
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('东方财富日线返回内容不是有效 JSON');
  }
  if (!payload || typeof payload !== 'object') throw new Error('东方财富日线响应无效');
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error('东方财富未返回历史日线');
  const row = data as Record<string, unknown>;
  if (String(row.code ?? '').trim() !== code) throw new Error('东方财富日线代码与当前基金不一致');
  if (!Array.isArray(row.klines)) throw new Error('东方财富未返回日线列表');
  const dailyCloses: DailyClose[] = row.klines.flatMap((entry): DailyClose[] => {
    if (typeof entry !== 'string') return [];
    const fields = entry.split(',');
    return fields.length >= 3 ? [{ date: fields[0], close: fields[2] }] : [];
  });
  return calculateBollBands(dailyCloses, quote.price, quote.tradingDate);
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

export async function fetchLatestMarketData(request: MarketQuoteRequest): Promise<MarketQuote> {
  const quote = await fetchLatestQuote(request);
  try {
    return { ...quote, boll: await fetchEastmoneyBollBands(request.code.trim(), request.market, quote) };
  } catch (error) {
    return { ...quote, bollError: error instanceof Error ? error.message : '东方财富日线不可用，未能计算 BOLL。' };
  }
}

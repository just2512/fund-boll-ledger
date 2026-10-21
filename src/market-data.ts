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

export type BollInterval = 'daily' | 'weekly' | 'monthly';

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
  weeklyBoll?: BollBands;
  weeklyBollError?: string;
  monthlyBoll?: BollBands;
  monthlyBollError?: string;
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
  // Prices are positive. The tiny epsilon avoids binary floating-point drift at decimal halves.
  const scaled = value * 1000;
  const rounded = Math.floor(scaled + 0.5 + Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2);
  return (rounded / 1000).toFixed(3);
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

interface SourceTimestamp {
  date: string;
  time?: string;
}

function shanghaiParts(now: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// Calendar digits: 14=yyyymmddhhmmss, 12=yyyymmddhhmm, 8=yyyymmdd. Returns null when not a plausible date.
function calendarFromDigits(digits: string): SourceTimestamp | null {
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  if (Number(year) < 2000 || Number(year) > 2100 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  const date = year + '-' + month + '-' + day;
  if (digits.length >= 14) {
    const hour = digits.slice(8, 10);
    const minute = digits.slice(10, 12);
    const second = digits.slice(12, 14);
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    return { date, time: hour + ':' + minute + ':' + second };
  }
  if (digits.length === 12) {
    const hour = digits.slice(8, 10);
    const minute = digits.slice(10, 12);
    if (Number(hour) > 23 || Number(minute) > 59) return null;
    return { date, time: hour + ':' + minute + ':00' };
  }
  return { date };
}

// Eastmoney f86 is a Unix epoch: 10 digits = seconds, 13 digits = milliseconds.
function epochFromDigits(digits: string): SourceTimestamp | null {
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  const seconds = digits.length === 13 ? Math.floor(value / 1000) : value;
  if (seconds < 946684800 || seconds > 4102444800) return null; // outside 2000..2100
  const parts = shanghaiParts(new Date(seconds * 1000));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function parseSourceTimestamp(value: unknown): SourceTimestamp | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== raw.length) return null;
  if (digits.length === 14 || digits.length === 12 || digits.length === 8) return calendarFromDigits(digits);
  // 10/13 digits: Eastmoney f86 is a Unix epoch (seconds/millis). Calendar yyyymmddhh readings
  // are never produced by our sources; preferring epoch also defuses the 2033-2036 window where
  // an epoch prefix would coincidentally parse as a valid calendar date.
  if (digits.length === 10 || digits.length === 13) return epochFromDigits(digits) ?? calendarFromDigits(digits);
  if (digits.length === 6) {
    const hour = digits.slice(0, 2);
    const minute = digits.slice(2, 4);
    const second = digits.slice(4, 6);
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    // hhmmss carries no date; stamping it with "today" would forge a trading date for BOLL
    // merging (weekend refresh would inject a ghost bar), so keep the time display only.
    return { date: '', time: hour + ':' + minute + ':' + second };
  }
  return null;
}

function tradingDateFrom(value: unknown): string | undefined {
  const parsed = parseSourceTimestamp(value);
  return parsed?.date ? parsed.date : undefined;
}

function parseMarketTime(value: unknown): string | undefined {
  const parsed = parseSourceTimestamp(value);
  if (!parsed) return undefined;
  // Dateless hhmmss stamps show time only; the full form carries the source trading date.
  return parsed.time ? (parsed.date ? `${parsed.date} ${parsed.time}（北京时间）` : `${parsed.time}（北京时间）`) : (parsed.date ? `${parsed.date}（北京时间）` : undefined);
}

async function requestText(url: string, encoding: 'utf-8' | 'gbk' = 'utf-8'): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('行情服务返回 HTTP ' + response.status);
    // Tencent serves GBK; decoding must treat multi-byte sequences atomically so a GBK
    // second byte of 0x7E never masquerades as the "~" field separator.
    if (encoding === 'gbk') {
      const buffer = await response.arrayBuffer();
      return new TextDecoder('gbk').decode(buffer);
    }
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
  const raw = await requestText('https://qt.gtimg.cn/q=' + symbol + '&_=' + String(Date.now()), 'gbk');
  const match = raw.match(/=\s*"([\s\S]*?)"\s*;/);
  if (!match) throw new Error('腾讯行情返回格式无法识别');
  const fields = match[1].split('~');
  if (String(fields[2] ?? '').trim() !== code) throw new Error('腾讯行情返回代码与当前基金不一致');
  if (fields.length < 33) throw new Error('腾讯行情字段不完整');
  const name = fields[1]?.trim() || undefined;
  return createQuote(code, name, fields[3], fields[4], fields[30], '腾讯行情');
}

function intervalPeriodKey(date: string, interval: BollInterval): string {
  if (interval === 'daily') return date;
  if (interval === 'monthly') return date.slice(0, 7);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

export function calculateBollBands(
  dailyCloses: DailyClose[],
  latestPrice?: string,
  latestPriceDate?: string,
  interval: BollInterval = 'daily',
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
      const latestKey = intervalPeriodKey(latestPriceDate, interval);
      const lastKey = last ? intervalPeriodKey(last.date, interval) : undefined;
      if (last && lastKey === latestKey) {
        // Weekly/monthly candle dates can precede the live quote date; compare interval identity.
        last.close = value;
        currentPriceApplied = true;
      } else if (last && lastKey !== undefined && latestKey > lastKey) {
        ordered.push({ date: latestPriceDate, close: value });
        currentPriceApplied = true;
      }
    } catch {
      // Keep raw history when the quote is malformed.
    }
  }
  if (ordered.length < BOLL_PERIOD) {
    const intervalLabel = interval === 'daily' ? '日线交易日' : interval === 'weekly' ? '周线周期' : '月线周期';
    const intervalName = interval === 'daily' ? '日' : interval === 'weekly' ? '周' : '月';
    throw new Error(`历史${intervalLabel}不足 20 根，暂时无法计算${intervalName} BOLL(20,2)。`);
  }

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
  interval: BollInterval,
): Promise<BollBands> {
  const secid = eastmoneyMarket(code, market) + '.' + code;
  const intervalLabel = interval === 'daily' ? '日线' : interval === 'weekly' ? '周线' : '月线';
  const params = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    ut: 'fa5fd1943c7b386f172d6893dbbd1d0c',
    klt: interval === 'daily' ? '101' : interval === 'weekly' ? '102' : '103',
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
    throw new Error(`东方财富${intervalLabel}返回内容不是有效 JSON`);
  }
  if (!payload || typeof payload !== 'object') throw new Error('东方财富日线响应无效');
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error(`东方财富未返回历史${intervalLabel}`);
  const row = data as Record<string, unknown>;
  if (String(row.code ?? '').trim() !== code) throw new Error(`东方财富${intervalLabel}代码与当前基金不一致`);
  if (!Array.isArray(row.klines)) throw new Error(`东方财富未返回${intervalLabel}列表`);
  const dailyCloses: DailyClose[] = row.klines.flatMap((entry): DailyClose[] => {
    if (typeof entry !== 'string') return [];
    const fields = entry.split(',');
    return fields.length >= 3 ? [{ date: fields[0], close: fields[2] }] : [];
  });
  return calculateBollBands(dailyCloses, quote.price, quote.tradingDate, interval);
}

export async function fetchLatestQuote(request: MarketQuoteRequest): Promise<MarketQuote> {
  const code = request.code.trim();
  if (!/^\d{6}$/.test(code)) throw new Error('请先在基金档案中填写有效的 6 位场内基金代码。');
  let eastmoneyError: Error | undefined;
  try {
    return await fetchEastmoneyQuote(code, request.market);
  } catch (error) {
    eastmoneyError = error instanceof Error ? error : new Error('东方财富请求失败');
  }
  try {
    return await fetchTencentQuote(code, request.market);
  } catch (error) {
    const tencentError = error instanceof Error ? error : new Error('腾讯行情请求失败');
    // Surface both source failures so "wrong code" and "network down" are distinguishable.
    throw new Error(`东方财富失败：${eastmoneyError.message}；腾讯失败：${tencentError.message}。请检查基金代码或网络连接。`);
  }
}

export async function fetchLatestMarketData(request: MarketQuoteRequest): Promise<MarketQuote> {
  const quote = await fetchLatestQuote(request);
  const code = request.code.trim();
  const [daily, weekly, monthly] = await Promise.allSettled([
    fetchEastmoneyBollBands(code, request.market, quote, 'daily'),
    fetchEastmoneyBollBands(code, request.market, quote, 'weekly'),
    fetchEastmoneyBollBands(code, request.market, quote, 'monthly'),
  ]);
  const errorText = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;
  return {
    ...quote,
    ...(daily.status === 'fulfilled' ? { boll: daily.value } : { bollError: errorText(daily.reason, '东方财富日线不可用，未能计算 BOLL。') }),
    ...(weekly.status === 'fulfilled' ? { weeklyBoll: weekly.value } : { weeklyBollError: errorText(weekly.reason, '东方财富周线不可用，未能计算周 BOLL。') }),
    ...(monthly.status === 'fulfilled' ? { monthlyBoll: monthly.value } : { monthlyBollError: errorText(monthly.reason, '东方财富月线不可用，未能计算月 BOLL。') }),
  };
}

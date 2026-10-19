export type FundCategory = 'ETF' | 'LOF' | '债券ETF' | '货币ETF' | '其他场内基金';
export type TradeSide = 'BUY' | 'SELL';
export type PriceBasisKey = 'upper' | 'middle' | 'lower' | 'previousClose' | 'lastTradePrice';
export type LadderDirection = 'up' | 'down';

export interface FundPrices {
  upper: string;
  middle: string;
  lower: string;
  previousClose: string;
  lastTradePrice: string;
  currentPrice: string;
}

export interface Fund {
  id: string;
  name: string;
  code: string;
  market: '沪市' | '深市' | '其他/未确认';
  category: FundCategory;
  tickSize: string;
  prices: FundPrices;
  ladderBasis: PriceBasisKey;
  ladderDirection: LadderDirection;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trade {
  id: string;
  fundId: string;
  tradedAt: string;
  side: TradeSide;
  price: string;
  quantity: string;
  commission: string;
  transferFee: string;
  stampDuty: string;
  otherFee: string;
  feesChecked: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceSnapshot {
  id: string;
  fundId: string;
  createdAt: string;
  tradingDate: string;
  prices: FundPrices;
  tickSize: string;
  note: string;
}

export interface AppData {
  schemaVersion: 1;
  funds: Fund[];
  trades: Trade[];
  snapshots: PriceSnapshot[];
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const EMPTY_PRICES: FundPrices = {
  upper: '', middle: '', lower: '', previousClose: '', lastTradePrice: '', currentPrice: '',
};

export function newFund(name = '新基金'): Fund {
  const now = new Date().toISOString();
  return {
    id: createId(), name, code: '', market: '其他/未确认', category: 'ETF',
    tickSize: '0.001',
    prices: { ...EMPTY_PRICES }, ladderBasis: 'lastTradePrice', ladderDirection: 'up',
    notes: '', createdAt: now, updatedAt: now,
  };
}

export function emptyAppData(): AppData {
  return { schemaVersion: 1, funds: [], trades: [], snapshots: [] };
}

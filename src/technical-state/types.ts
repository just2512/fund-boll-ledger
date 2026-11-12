import type { MacdPeriodState } from '../macd';

export type TechnicalInterval = 'daily' | 'weekly' | 'monthly';
export type TechnicalValidity = 'VALID' | 'INSUFFICIENT' | 'INVALID' | 'UNAVAILABLE';
export type TechnicalQuoteSource = '东方财富' | '腾讯行情' | '百度行情';

export interface TechnicalRawBar {
  /** Exchange trading date in YYYY-MM-DD form; never a device-local timestamp. */
  date: string;
  /** Raw provider value; normalized and validated before entering an indicator engine. */
  close: string | number;
}

export interface TechnicalBar {
  /** Exchange trading date in YYYY-MM-DD form; never a device-local timestamp. */
  date: string;
  /** Unrounded, finite, positive close price. */
  close: number;
}

export interface TechnicalQuoteContext {
  /** Trading date parsed from the quote source. Missing dates must fail closed. */
  tradingDate?: string;
  /** Source timestamp including Beijing time when supplied by the source. */
  quotedAt?: string;
  quoteSource?: TechnicalQuoteSource;
}

export interface TechnicalHistoryInput {
  interval: TechnicalInterval;
  bars: readonly TechnicalRawBar[];
  /** Actual provider used for these K lines; may differ from the spot quote provider. */
  source?: TechnicalQuoteSource;
  quote: TechnicalQuoteContext;
}

export interface ConfirmedTechnicalSeries {
  interval: TechnicalInterval;
  /** Last confirmed bar date represented by bars. */
  asOfDate: string;
  /** Ascending, unique, normalized bars; current/in-progress bars are excluded. */
  bars: readonly TechnicalBar[];
  /** Provider used for the K-line series, not necessarily the spot quote provider. */
  source?: TechnicalQuoteSource;
  /** True when the latest source bar was excluded because its period is still open. */
  excludedInProgressBar: boolean;
}

export type TechnicalNormalizationResult =
  | { validity: 'VALID'; series: ConfirmedTechnicalSeries }
  | { validity: 'INSUFFICIENT'; reason: string; interval: TechnicalInterval }
  | { validity: 'INVALID'; reason: string; interval: TechnicalInterval }
  | { validity: 'UNAVAILABLE'; reason: string; interval: TechnicalInterval };

export type BollBandwidthPhase =
  | 'contracting'
  | 'contracting-persistent'
  | 'expanding'
  | 'expanding-persistent'
  | 'contracting-to-expanding'
  | 'expanding-to-contracting'
  | 'flat'
  | 'unknown';

export type BollMiddleDirection =
  | 'up'
  | 'down'
  | 'flat'
  | 'turning-up'
  | 'turning-down'
  | 'unknown';

export type BollPriceLocation =
  | 'below-lower'
  | 'near-lower'
  | 'below-middle'
  | 'above-middle'
  | 'near-upper'
  | 'above-upper'
  | 'unknown';

export interface BollHistoryPoint {
  date: string;
  close: number;
  upper?: number;
  middle?: number;
  lower?: number;
  bandwidthPercent?: number;
  bandwidthPercentile?: number;
  bandwidthSampleCount?: number;
  bandwidthPhase: BollBandwidthPhase;
  bandwidthPhaseStartDate?: string;
  /** First bar in the N-bar confirmation window for the current bandwidth phase. */
  bandwidthPhaseObservationStartDate?: string;
  middleDirection: BollMiddleDirection;
  middleDirectionStartDate?: string;
  /** First bar in the N-bar confirmation window for the current middle direction. */
  middleDirectionObservationStartDate?: string;
  closeLocationPercent?: number;
  priceLocation: BollPriceLocation;
}

export interface BollState {
  validity: TechnicalValidity;
  asOfDate?: string;
  upper?: number;
  middle?: number;
  lower?: number;
  /** (upper - lower) / middle * 100; calculated before display rounding. */
  bandwidthPercent?: number;
  /** Empirical trailing-window percentile, including the current confirmed bar. */
  bandwidthPercentile?: number;
  bandwidthSampleCount?: number;
  bandwidthChange1?: number;
  bandwidthChange3?: number;
  bandwidthChange5?: number;
  middleChangePercent?: number;
  bandwidthPhase: BollBandwidthPhase;
  bandwidthPhaseStartDate?: string;
  bandwidthPhaseObservationStartDate?: string;
  middleDirection: BollMiddleDirection;
  middleDirectionStartDate?: string;
  middleDirectionObservationStartDate?: string;
  /** Historical close relative to same-bar bands; never the live quote. */
  closeLocationPercent?: number;
  priceLocation: BollPriceLocation;
  reason?: string;
}

export interface TechnicalStateSnapshot {
  interval: TechnicalInterval;
  /** Absent only when no confirmed bar could be produced. */
  asOfDate?: string;
  /** K-line provider and spot-quote provider are tracked independently. */
  source?: TechnicalQuoteSource;
  quoteSource?: TechnicalQuoteSource;
  /** Coverage metadata describes only the loaded/confirmed window. */
  historyStartDate?: string;
  confirmedBarCount: number;
  excludedInProgressBar: boolean;
  boll: BollState;
  bollConfig?: BollStateConfig;
  bollConfigVersion?: string;
  bollHistory: BollHistoryPoint[];
  macd: MacdPeriodState;
  macdHistory: import('../macd').MacdHistoryPoint[];
  validity: TechnicalValidity;
  reason?: string;
}

export interface TechnicalMultiTimeframeState {
  daily: TechnicalStateSnapshot;
  weekly: TechnicalStateSnapshot;
  monthly: TechnicalStateSnapshot;
}

export interface BollStateConfig {
  /** Existing indicator contract: BOLL(20, 2), population standard deviation. */
  bollPeriod: 20;
  standardDeviations: 2;
  /** Explicit trailing sample count; no hidden default. */
  bandwidthRankLookback: number;
  /** Minimum valid samples required before emitting a percentile. */
  bandwidthRankMinimumSamples: number;
  /** Explicit number of bars used to measure middle-band direction. */
  middleDirectionLookback: number;
  /** Percentage tolerance within which bandwidth/middle changes count as flat. */
  flatTolerancePercent: number;
  /** Number of consecutive directional observations required for persistent/turning labels. */
  confirmationBars: number;
  /** Distance from an outer band, in percent of band width, used for near-band labels. */
  nearBandDistancePercent: number;
}

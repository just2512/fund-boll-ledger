import { calculateMacdFromConfirmedSeries, unavailableMacdPeriod } from '../macd';
import type { MacdPeriodState } from '../macd';
import { calculateBollState } from './boll-state';
import type {
  BollState,
  BollStateConfig,
  ConfirmedTechnicalSeries,
  TechnicalInterval,
  TechnicalQuoteSource,
  TechnicalStateSnapshot,
  TechnicalValidity,
} from './types';

function macdValidity(series: ConfirmedTechnicalSeries, macd: MacdPeriodState): TechnicalValidity {
  if (!macd.error) return 'VALID';
  return series.bars.length < 35 ? 'INSUFFICIENT' : 'INVALID';
}

/** Calculate BOLL and MACD from exactly the same already-confirmed historical prefix. */
export function calculateTechnicalStateSnapshot(
  series: ConfirmedTechnicalSeries,
  config?: BollStateConfig,
  quoteSource?: TechnicalQuoteSource,
): TechnicalStateSnapshot {
  const boll = calculateBollState(series, config);
  const macd = calculateMacdFromConfirmedSeries(series);
  const macdStatus = macdValidity(series, macd);
  const validity: TechnicalValidity = boll.validity !== 'VALID' ? boll.validity : macdStatus;
  const reasons = [boll.reason, macd.error].filter((value): value is string => Boolean(value));
  return {
    interval: series.interval,
    asOfDate: series.asOfDate,
    ...(series.source ? { source: series.source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    ...(series.bars[0] ? { historyStartDate: series.bars[0].date } : {}),
    confirmedBarCount: series.bars.length,
    excludedInProgressBar: series.excludedInProgressBar,
    boll,
    macd,
    validity,
    ...(reasons.length ? { reason: reasons.join('；') } : {}),
  };
}

/** Build an explicit unavailable snapshot when normalization or provider retrieval fails. */
export function unavailableTechnicalState(
  interval: TechnicalInterval,
  validity: TechnicalValidity,
  reason: string,
  source?: TechnicalQuoteSource,
  quoteSource?: TechnicalQuoteSource,
): TechnicalStateSnapshot {
  const boll: BollState = {
    validity,
    bandwidthPhase: 'unknown',
    middleDirection: 'unknown',
    priceLocation: 'unknown',
    reason,
  };
  return {
    interval,
    ...(source ? { source } : {}),
    ...(quoteSource ? { quoteSource } : {}),
    confirmedBarCount: 0,
    excludedInProgressBar: false,
    boll,
    macd: unavailableMacdPeriod(interval, reason),
    validity,
    reason,
  };
}

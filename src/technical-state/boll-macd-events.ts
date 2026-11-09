import { calculateTechnicalStateSnapshot } from './engine';
import type { ConfirmedTechnicalSeries, TechnicalInterval } from './types';
import type { MacdCrossEvent } from '../macd';

export type BollMacdTouchSide = 'lower' | 'upper';
export type BollMacdSetupStatus = 'confirmed' | 'invalidated' | 'pending';
export type BollMacdInvalidationReason = 'opposite-macd-cross' | 'opposite-boll-touch';

export interface BollMacdObservation {
  date: string;
  close: number;
  bollLower?: number;
  bollUpper?: number;
  macdCrossEvent: MacdCrossEvent;
}

export interface BollMacdTouchSetup {
  interval: TechnicalInterval;
  side: BollMacdTouchSide;
  triggerDate: string;
  triggerClose: number;
  triggerBand: number;
  status: BollMacdSetupStatus;
  expectedCross: 'golden' | 'death';
  confirmationDate?: string;
  confirmationClose?: number;
  barsToCross?: number;
  calendarDaysToCross?: number;
  closeChangePercent?: number;
  invalidationReason?: BollMacdInvalidationReason;
}

interface PendingSetup {
  setup: BollMacdTouchSetup;
  triggerIndex: number;
}

function isCalendarDate(value: string): boolean {\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;\n  const date = new Date(value + 'T00:00:00.000Z');\n  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;\n}\n\nfunction sideFor(close: number, lower?: number, upper?: number): BollMacdTouchSide | undefined {
  if (lower !== undefined && close <= lower) return 'lower';
  if (upper !== undefined && close >= upper) return 'upper';
  return undefined;
}

function calendarDaysBetween(start: string, end: string): number {
  const startMs = Date.parse(start + 'T00:00:00.000Z');
  const endMs = Date.parse(end + 'T00:00:00.000Z');
  return Math.round((endMs - startMs) / 86_400_000);
}

/**
 * Pair a confirmed-close BOLL touch with the first later matching MACD cross.
 *
 * A lower-band close waits for a later golden cross; an upper-band close waits
 * for a later death cross. A cross on the touch date is deliberately not valid.
 * Only one setup is active: an opposite MACD cross or opposite BOLL touch
 * invalidates it. Repeated touches on the same side do not reset the trigger date.
 *
 * "Touch" here means the confirmed close is at/beyond the band. Close-only
 * history cannot establish an intraday high/low touch.
 */
export function pairBollTouchesWithMacdCrosses(
  interval: TechnicalInterval,
  observations: readonly BollMacdObservation[],
): BollMacdTouchSetup[] {
  const setups: BollMacdTouchSetup[] = [];
  let pending: PendingSetup | undefined;
  let previousDate = '';

  for (let index = 0; index < observations.length; index += 1) {
    const item = observations[index];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date <= previousDate) {
      throw new Error('观察序列日期无效、未排序或存在重复日期');
    }
    previousDate = item.date;
    if (!Number.isFinite(item.close) || item.close <= 0) {
      throw new Error('观察序列收盘价必须是有限正数：' + item.date);
    }
    if (item.bollLower !== undefined && (!Number.isFinite(item.bollLower) || item.bollLower <= 0)) {
      throw new Error('BOLL 下轨无效：' + item.date);
    }
    if (item.bollUpper !== undefined && (!Number.isFinite(item.bollUpper) || item.bollUpper <= 0)) {
      throw new Error('BOLL 上轨无效：' + item.date);
    }

    const touched = sideFor(item.close, item.bollLower, item.bollUpper);
    if (pending && index > pending.triggerIndex) {
      const expected = pending.setup.expectedCross;
      const opposite = expected === 'golden' ? 'death' : 'golden';
      if (item.macdCrossEvent === expected) {
        const triggerClose = pending.setup.triggerClose;
        pending.setup.status = 'confirmed';
        pending.setup.confirmationDate = item.date;
        pending.setup.confirmationClose = item.close;
        pending.setup.barsToCross = index - pending.triggerIndex;
        pending.setup.calendarDaysToCross = calendarDaysBetween(pending.setup.triggerDate, item.date);
        pending.setup.closeChangePercent = (item.close / triggerClose - 1) * 100;
        pending = undefined;
      } else if (item.macdCrossEvent === opposite) {
        pending.setup.status = 'invalidated';
        pending.setup.invalidationReason = 'opposite-macd-cross';
        pending = undefined;
      } else if (touched && touched !== pending.setup.side) {
        pending.setup.status = 'invalidated';
        pending.setup.invalidationReason = 'opposite-boll-touch';
        pending = undefined;
      }
    }

    // Create only after checking the current day's cross, so same-day touch/cross
    // combinations can never be treated as "touch first, cross later".
    if (!pending && touched) {
      const triggerBand = touched === 'lower' ? item.bollLower : item.bollUpper;
      if (triggerBand === undefined) continue;
      const setup: BollMacdTouchSetup = {
        interval,
        side: touched,
        triggerDate: item.date,
        triggerClose: item.close,
        triggerBand,
        status: 'pending',
        expectedCross: touched === 'lower' ? 'golden' : 'death',
      };
      setups.push(setup);
      pending = { setup, triggerIndex: index };
    }
  }

  return setups;
}

/**
 * Build each observation from the formal BOLL/MACD engines using the same
 * confirmed prefix and EMA seed. No live quote or unconfirmed bar is accepted.
 */
export function auditConfirmedBollMacdSeries(
  series: ConfirmedTechnicalSeries,
): BollMacdTouchSetup[] {
  const observations: BollMacdObservation[] = [];
  for (let index = 0; index < series.bars.length; index += 1) {
    const bars = series.bars.slice(0, index + 1);
    const prefix: ConfirmedTechnicalSeries = {
      ...series,
      asOfDate: bars[bars.length - 1].date,
      bars,
      excludedInProgressBar: index === series.bars.length - 1 ? series.excludedInProgressBar : false,
    };
    const snapshot = calculateTechnicalStateSnapshot(prefix);
    if (snapshot.boll.validity !== 'VALID' || snapshot.macd.error) continue;
    observations.push({
      date: prefix.asOfDate,
      close: bars[bars.length - 1].close,
      ...(snapshot.boll.lower !== undefined ? { bollLower: snapshot.boll.lower } : {}),
      ...(snapshot.boll.upper !== undefined ? { bollUpper: snapshot.boll.upper } : {}),
      macdCrossEvent: snapshot.macd.crossEvent,
    });
  }
  return pairBollTouchesWithMacdCrosses(series.interval, observations);
}

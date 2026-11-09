import { describe, expect, it } from 'vitest';
import { pairBollTouchesWithMacdCrosses, type BollMacdObservation } from './boll-macd-events';

function observation(
  date: string,
  close: number,
  options: Partial<Pick<BollMacdObservation, 'bollLower' | 'bollUpper' | 'macdCrossEvent'>> = {},
): BollMacdObservation {
  return {
    date,
    close,
    macdCrossEvent: 'none',
    ...options,
  };
}

describe('confirmed BOLL touch then MACD cross event audit', () => {
  it('confirms a lower-band setup only on a later golden cross and measures the close change', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 10.2),
      observation('2026-01-07', 10.5, { macdCrossEvent: 'golden' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      side: 'lower',
      status: 'confirmed',
      triggerDate: '2026-01-05',
      triggerClose: 9.8,
      triggerBand: 10,
      expectedCross: 'golden',
      confirmationDate: '2026-01-07',
      confirmationClose: 10.5,
      barsToCross: 2,
      calendarDaysToCross: 2,
    });
    expect(result[0].closeChangePercent).toBeCloseTo((10.5 / 9.8 - 1) * 100, 10);
  });

  it('does not accept a MACD cross on the same date as the BOLL touch', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10, macdCrossEvent: 'golden' }),
      observation('2026-01-06', 10.1),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
    expect(result[0].confirmationDate).toBeUndefined();
  });

  it('invalidates a pending setup when the opposite MACD cross occurs first', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 10.1, { macdCrossEvent: 'death' }),
    ]);
    expect(result[0]).toMatchObject({
      status: 'invalidated',
      invalidationReason: 'opposite-macd-cross',
    });
  });

  it('supersedes a pending lower touch when an upper-band touch appears', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 12.2, { bollUpper: 12 }),
      observation('2026-01-07', 12.1, { macdCrossEvent: 'death' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      side: 'lower',
      status: 'invalidated',
      invalidationReason: 'opposite-boll-touch',
    });
    expect(result[1]).toMatchObject({
      side: 'upper',
      status: 'confirmed',
      expectedCross: 'death',
      triggerDate: '2026-01-06',
      confirmationDate: '2026-01-07',
      barsToCross: 1,
    });
  });

  it('invalidates the old setup when an opposite touch and matching cross occur on the same bar', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 12.2, { bollUpper: 12, macdCrossEvent: 'golden' }),
      observation('2026-01-07', 12.1),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      side: 'lower',
      status: 'invalidated',
      invalidationReason: 'opposite-boll-touch',
    });
    expect(result[0].confirmationDate).toBeUndefined();
    expect(result[1]).toMatchObject({
      side: 'upper',
      status: 'pending',
      expectedCross: 'death',
      triggerDate: '2026-01-06',
    });
    expect(result[1].confirmationDate).toBeUndefined();
  });


  it('invalidates the old setup when an opposite MACD cross and opposite touch occur on the same bar', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 12.2, { bollUpper: 12, macdCrossEvent: 'death' }),
      observation('2026-01-07', 12.1),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      side: 'lower',
      status: 'invalidated',
      invalidationReason: 'opposite-macd-cross',
    });
    expect(result[0].confirmationDate).toBeUndefined();
    expect(result[1]).toMatchObject({
      side: 'upper',
      status: 'pending',
      expectedCross: 'death',
      triggerDate: '2026-01-06',
    });
    expect(result[1].confirmationDate).toBeUndefined();
  });


  it('clears an invalidated setup before accepting a fresh same-side touch on that bar', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 9.7, { bollLower: 10, macdCrossEvent: 'death' }),
      observation('2026-01-07', 10.2, { macdCrossEvent: 'golden' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      triggerDate: '2026-01-05',
      status: 'invalidated',
      invalidationReason: 'opposite-macd-cross',
    });
    expect(result[1]).toMatchObject({
      triggerDate: '2026-01-06',
      status: 'confirmed',
      confirmationDate: '2026-01-07',
      barsToCross: 1,
    });
  });

  it('keeps the first touch date when the same side is touched repeatedly', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 9.7, { bollLower: 10 }),
      observation('2026-01-07', 10.2, { macdCrossEvent: 'golden' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].triggerDate).toBe('2026-01-05');
    expect(result[0].barsToCross).toBe(2);
  });

  it('leaves a setup pending when the loaded history ends before its matching cross', () => {
    const result = pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 9.8, { bollLower: 10 }),
      observation('2026-01-06', 10.1),
    ]);
    expect(result[0].status).toBe('pending');
    expect(result[0].confirmationDate).toBeUndefined();
  });

  it('rejects unordered or duplicate dates and invalid prices', () => {
    expect(() => pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-06', 10),
      observation('2026-01-05', 10),
    ])).toThrow('日期');
    expect(() => pairBollTouchesWithMacdCrosses('daily', [
      observation('2026-01-05', 0),
    ])).toThrow('收盘价');
  });
});

import { describe, expect, it } from 'vitest';
import { calculatePosition, priceLadder } from './calculations';
import { formatCents, formatScaled, parseMoneyCents, parseScaled, percentHundredths, priceAmountCents, roundDiv, roundToTick } from './decimal';
import type { Trade } from './types';

function t(partial: Partial<Trade> & Pick<Trade, 'side' | 'price' | 'quantity'>): Trade {
  const { side, price, quantity, ...o } = partial;
  return {
    id: crypto.randomUUID(), fundId: 'f1', tradedAt: '2026-10-16T09:30', commission: '0', transferFee: '0',
    stampDuty: '0', otherFee: '0', feesChecked: false, note: '', createdAt: '2026-10-16T09:31:00.000Z',
    updatedAt: '2026-10-16T09:31:00.000Z', ...o, side, price, quantity,
  };
}

describe('decimal edge cases', () => {
  it('rounds money half-up at the cent boundary', () => {
    expect(parseMoneyCents('1.005')).toBe(101n);
    expect(parseMoneyCents('1.004')).toBe(100n);
    expect(parseMoneyCents('-1.005')).toBe(-101n);
    expect(parseMoneyCents('')).toBe(0n);
  });

  it('formats negative fixed-point values without drift', () => {
    expect(formatCents(-101n)).toBe('-1.01');
    expect(formatScaled(-10001000n, 3)).toBe('-10.001');
  });

  it('rounds to tick half-up and handles sub-cent amounts', () => {
    expect(roundToTick(1049999n, 1000n)).toBe(1050000n);
    expect(roundDiv(1n, 2n)).toBe(1n);
    expect(roundDiv(0n, 2n)).toBe(0n);
    expect(priceAmountCents('10.001', '100')).toBe(100010n);
  });

  it('parses scientific notation and rejects garbage', () => {
    expect(parseScaled('1e-7')).toBe(0n);
    expect(parseScaled('+1.5')).toBe(1500000n);
    expect(() => parseScaled('abc')).toThrow();
    expect(() => parseScaled('1,000')).toThrow();
  });

  it('computes negative percent correctly', () => {
    expect(percentHundredths(9200000n, 10500000n)).toBe(-12.38);
  });
});

describe('position edge cases', () => {
  it('partial sells round allocation and never go negative', () => {
    const trades = [
      t({ side: 'BUY', price: '0.33', quantity: '3', commission: '0.01' }),
      t({ side: 'SELL', price: '0.5', quantity: '1', tradedAt: '2026-10-16T10:00', createdAt: '2026-10-16T10:00:00.000Z' }),
      t({ side: 'SELL', price: '0.5', quantity: '1', tradedAt: '2026-10-16T11:00', createdAt: '2026-10-16T11:00:00.000Z' }),
      t({ side: 'SELL', price: '0.5', quantity: '1', tradedAt: '2026-10-16T12:00', createdAt: '2026-10-16T12:00:00.000Z' }),
    ];
    const r = calculatePosition(trades, 'f1');
    expect(r.error).toBeUndefined();
    expect(r.quantity).toBe(0n);
    expect(r.costBasisCents).toBe(0n);
  });

  it('allows selling exactly the full holding but not one share more', () => {
    const ok = calculatePosition([
      t({ side: 'BUY', price: '10', quantity: '100' }),
      t({ side: 'SELL', price: '10', quantity: '100', tradedAt: '2026-10-16T10:00' }),
    ], 'f1');
    expect(ok.error).toBeUndefined();
    expect(ok.quantity).toBe(0n);

    const bad = calculatePosition([
      t({ side: 'BUY', price: '10', quantity: '100' }),
      t({ side: 'SELL', price: '10', quantity: '101', tradedAt: '2026-10-16T10:00' }),
    ], 'f1');
    expect(bad.error).toContain('超过当时持仓');
  });

  it('detects an oversell inserted mid-history (out-of-order tradedAt)', () => {
    // Buy 100, sell 60, then a backdated sell of 50 -> oversell at that point.
    const trades = [
      t({ side: 'BUY', price: '10', quantity: '100', tradedAt: '2026-10-01T09:00' }),
      t({ side: 'SELL', price: '10', quantity: '60', tradedAt: '2026-10-03T09:00' }),
      t({ side: 'SELL', price: '10', quantity: '50', tradedAt: '2026-10-02T09:00' }),
    ];
    const r = calculatePosition(trades, 'f1');
    expect(r.error).toContain('超过当时持仓');
  });
});

describe('ladder boundary cases', () => {
  it('marks a level reached when current exactly equals the step price', () => {
    const up = priceLadder('10.000', '0.001', 'up', '10.100');
    expect(up).toHaveLength(10);
    expect(up[0].price).toBe('10.100');
    expect(up[0].reached).toBe(true);
    expect(up[1].isNext).toBe(true);
  });

  it('rounds ladder prices to a coarser tick', () => {
    const rows = priceLadder('10.800', '0.01', 'up', '10.95');
    expect(rows[0].price).toBe('10.91');
    expect(rows[9].price).toBe('11.88');
  });

  it('returns empty ladder when base is missing or non-positive', () => {
    expect(priceLadder('', '0.001', 'up', '10')).toEqual([]);
    expect(priceLadder('0', '0.001', 'up', '10')).toEqual([]);
    expect(priceLadder('-1', '0.001', 'up', '10')).toEqual([]);
  });
});
import { describe, expect, it } from 'vitest';
import { compareToBases, calculatePosition, priceLadder } from './calculations';
import { parseScaled, priceAmountCents, formatCents } from './decimal';
import type { FundPrices, Trade } from './types';

const prices: FundPrices = { upper: '10.800', middle: '10.000', lower: '9.200', previousClose: '10.500', lastTradePrice: '10.500', currentPrice: '10.950' };

function trade(partial: Partial<Trade> & Pick<Trade, 'side' | 'price' | 'quantity'>): Trade {
  const { side, price, quantity, ...overrides } = partial;
  return {
    id: crypto.randomUUID(), fundId: 'f1', tradedAt: '2026-10-16T09:30', commission: '0', transferFee: '0', stampDuty: '0', otherFee: '0',
    feesChecked: false, note: '', createdAt: '2026-10-16T09:31:00.000Z', updatedAt: '2026-10-16T09:31:00.000Z', ...overrides, side, price, quantity,
  };
}

describe('price ladder', () => {
  it('calculates each level from the original base, not compounding', () => {
    const rows = priceLadder('10.500', '0.001', 'up', '10.950');
    expect(rows).toHaveLength(10);
    expect(rows[0].price).toBe('10.605');
    expect(rows[1].price).toBe('10.710');
    expect(rows[9].price).toBe('11.550');
    expect(rows[3].reached).toBe(true);
    expect(rows[4].isNext).toBe(true);
  });

  it('calculates downward levels and marks those crossed by current price', () => {
    const rows = priceLadder('10.500', '0.001', 'down', '10.200');
    expect(rows[0].price).toBe('10.395');
    expect(rows[2].price).toBe('10.185');
    expect(rows[0].reached).toBe(true);
    expect(rows[1].reached).toBe(true);
    expect(rows[2].reached).toBe(false);
    expect(rows[2].isNext).toBe(true);
  });

  it('rounds to the chosen tick', () => {
    const rows = priceLadder('10.800', '0.01', 'up', '10.95');
    expect(rows[0].price).toBe('10.91');
  });
});

describe('comparison', () => {
  it('compares current price against all five independent bases', () => {
    const result = compareToBases(prices);
    expect(result).toHaveLength(5);
    expect(result[0].percent).toBe(1.39);
    expect(result[1].percent).toBe(9.5);
    expect(result[4].percent).toBe(4.29);
    expect(result[4].delta).toBe('0.450');
  });
});

describe('cost basis and realized P/L', () => {
  it('includes buying and selling fees in realized and unrealized P/L', () => {
    const trades = [
      trade({ id: 'b1', side: 'BUY', tradedAt: '2026-10-15T09:30', price: '10', quantity: '100', commission: '1' }),
      trade({ id: 'b2', side: 'BUY', tradedAt: '2026-10-15T10:30', price: '12', quantity: '100', commission: '1' }),
      trade({ id: 's1', side: 'SELL', tradedAt: '2026-10-16T10:30', price: '13', quantity: '100', commission: '1' }),
    ];
    const result = calculatePosition(trades, 'f1');
    expect(result.error).toBeUndefined();
    expect(result.quantity).toBe(100n);
    expect(result.costBasisCents).toBe(110100n);
    expect(result.realizedCents).toBe(19800n);
    expect(result.feesCents).toBe(300n);
  });

  it('rejects overselling instead of silently allowing negative holdings', () => {
    const result = calculatePosition([trade({ side: 'SELL', price: '10', quantity: '1' })], 'f1');
    expect(result.error).toContain('超过当时持仓');
  });

  it('uses fixed-point arithmetic for money', () => {
    expect(formatCents(priceAmountCents('10.001', '100'))).toBe('1000.10');
    expect(parseScaled('10.001')).toBe(10001000n);
  });
});

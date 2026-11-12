import { describe, expect, it } from 'vitest';
import { calculateTechnicalStateSnapshot, describeTechnicalMultiTimeframeState, describeTechnicalStateSnapshot, unavailableTechnicalState } from './engine';
import { compareBatchWithReplay, hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import { bollStateConfigFor } from './config';
import type { ConfirmedTechnicalSeries, TechnicalBar } from './types';

function series(source: '东方财富' | '百度行情' = '东方财富', count = 220): ConfirmedTechnicalSeries {
  const first = new Date('2025-01-01T00:00:00.000Z');
  const bars: TechnicalBar[] = Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    const close = index < 45 ? 30 - index * 0.25 : 18.75 + (index - 45) * 0.32;
    return { date: date.toISOString().slice(0, 10), close };
  });
  return {
    interval: 'daily',
    asOfDate: bars[bars.length - 1].date,
    bars,
    source,
    excludedInProgressBar: false,
  };
}

describe('combined BOLL/MACD technical state engine', () => {
  it('uses one confirmed prefix and exposes its actual source and loaded coverage', () => {
    const input = series();
    const state = calculateTechnicalStateSnapshot(input, undefined, '百度行情');
    expect(state.asOfDate).toBe(input.asOfDate);
    expect(state.boll.asOfDate).toBe(input.asOfDate);
    expect(state.macd.asOfDate).toBe(input.asOfDate);
    expect(state.formulaVersion).toBe('technical-formula-v1');
    expect(state.source).toBe('东方财富');
    expect(state.quoteSource).toBe('百度行情');
    expect(state.historyStartDate).toBe(input.bars[0].date);
    expect(state.confirmedBarCount).toBe(220);
    expect(state.excludedInProgressBar).toBe(false);
    expect(state.macd.barsUsed).toBe(220);
    expect(state.validity).toBe('VALID');
    expect(state.boll.middleDirection).toBe('unknown');
    expect(state.boll.bandwidthPhase).toBe('unknown');
    expect(state.boll.bandwidthPercent).toBeDefined();
  });

  it('applies the empirically evaluated interval configuration to BOLL state labels', () => {
    const snapshot = calculateTechnicalStateSnapshot(series(), bollStateConfigFor('daily'));
    expect(snapshot.boll.validity).toBe('VALID');
    expect(snapshot.boll.bandwidthPercentile).toBeDefined();
    expect(snapshot.boll.bandwidthPhase).not.toBe('unknown');
    expect(snapshot.boll.middleDirection).not.toBe('unknown');
    expect(snapshot.boll.bandwidthPhaseStartDate).toBe(snapshot.bollHistory.at(-1)?.bandwidthPhaseStartDate);
    expect(snapshot.boll.bandwidthPhaseObservationStartDate).toBe(snapshot.bollHistory.at(-1)?.bandwidthPhaseObservationStartDate);
    expect(snapshot.boll.middleDirectionStartDate).toBe(snapshot.bollHistory.at(-1)?.middleDirectionStartDate);
    expect(snapshot.boll.middleDirectionObservationStartDate).toBe(snapshot.bollHistory.at(-1)?.middleDirectionObservationStartDate);
    expect(snapshot.boll.reason).toBeUndefined();
  });

  it('does not let a K-line provider switch alter confirmed BOLL or MACD state', () => {
    const input = series();
    const eastmoney = calculateTechnicalStateSnapshot(input, undefined, '东方财富');
    const baidu = calculateTechnicalStateSnapshot({ ...input, source: '百度行情' }, undefined, '东方财富');
    expect(eastmoney.macd).toEqual(baidu.macd);
    expect(eastmoney.boll).toEqual(baidu.boll);
    expect(eastmoney.source).not.toBe(baidu.source);
  });

  it('replays BOLL and MACD together without future bars and matches batch output', () => {
    const input = series();
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const entries = replayConfirmedTechnicalSeries(input, calculate);
    expect(hasNoFutureBars(entries)).toBe(true);
    const comparison = compareBatchWithReplay(input, calculate);
    expect(comparison?.matches).toBe(true);
    expect(entries.slice(0, 159).every((entry) => entry.result.macd.availability === 'insufficient-history')).toBe(true);
    expect(entries.slice(159).every((entry) => entry.result.macd.availability === 'ready')).toBe(true);
    expect(entries.at(-1)?.result.macd.crossEvent).toBe('none');
    expect(['golden', 'death']).toContain(entries.at(-1)?.result.macd.lastCross);
  });

  it('preserves excluded in-progress bar metadata on the final replay prefix', () => {
    const input = { ...series(), excludedInProgressBar: true };
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const replay = replayConfirmedTechnicalSeries(input, calculate);
    expect(replay.at(-1)?.series.excludedInProgressBar).toBe(true);
    expect(replay.slice(0, -1).every((entry) => !entry.series.excludedInProgressBar)).toBe(true);
    expect(compareBatchWithReplay(input, calculate)?.matches).toBe(true);
  });

  it('keeps earlier combined indicator results unchanged when future bars are appended', () => {
    const original = series('东方财富', 180);
    const extended = series('东方财富', 220);
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const before = replayConfirmedTechnicalSeries(original, calculate);
    const after = replayConfirmedTechnicalSeries(extended, calculate);
    expect(after.slice(0, before.length).map((entry) => entry.result))
      .toEqual(before.map((entry) => entry.result));
  });

  it('describes each indicator from its structured fields without inventing a composite trading direction', () => {
    const snapshot = calculateTechnicalStateSnapshot(series());
    const description = describeTechnicalStateSnapshot(snapshot);
    expect(description).toContain('日线');
    expect(description).toContain('BOLL(20,2)');
    expect(description).toContain('带宽阶段 未配置');
    expect(description).toContain('中轨方向 未配置');
    expect(description).toContain('MACD(12,26,9)');
    expect(description).toContain('DIF/DEA');
    expect(description).toContain('不构成买卖方向或交易指令');
    expect(description).toContain('状态阈值未配置');
  });

  it('classifies overall technical bias using confirmed multi-timeframe hard gates without scores', () => {
    const makePeriod = (
      interval: 'daily' | 'weekly' | 'monthly',
      middleDirection: 'up' | 'down' | 'flat' | 'turning-up' | 'turning-down' | 'unknown',
      lineRelation: 'bullish' | 'bearish' | 'equal' | 'unknown',
      zeroAxis: 'above' | 'below' | 'at-zero' | 'unknown',
    ) => {
      const base = calculateTechnicalStateSnapshot({ ...series(), interval }, bollStateConfigFor(interval));
      return {
        ...base,
        boll: { ...base.boll, validity: 'VALID' as const, middleDirection },
        macd: {
          ...base.macd,
          interval,
          availability: 'ready' as const,
          lineRelation,
          zeroAxis,
        },
      };
    };
    const set = (daily: ReturnType<typeof makePeriod>, weekly: ReturnType<typeof makePeriod>, monthly: ReturnType<typeof makePeriod>) =>
      describeTechnicalMultiTimeframeState({ daily, weekly, monthly }).overallTrend;
    const bull = (period: 'daily' | 'weekly' | 'monthly') => makePeriod(period, 'up', 'bullish', 'above');
    const bear = (period: 'daily' | 'weekly' | 'monthly') => makePeriod(period, 'down', 'bearish', 'below');
    const flat = (period: 'daily' | 'weekly' | 'monthly') => makePeriod(period, 'flat', 'equal', 'above');

    expect(set(bull('daily'), bull('weekly'), bull('monthly'))).toBe('多周期偏多');
    expect(set(bear('daily'), bull('weekly'), bull('monthly'))).toBe('中期偏多（短线回调）');
    expect(set(bull('daily'), bear('weekly'), bear('monthly'))).toBe('中期偏空（短线反弹）');
    expect(set(bear('daily'), bear('weekly'), bear('monthly'))).toBe('多周期偏空');
    expect(set(flat('daily'), flat('weekly'), flat('monthly'))).toBe('三周期震荡');
    expect(set(bull('daily'), bull('weekly'), bear('monthly'))).toBe('多空分歧');

    const earlyBullCross = makePeriod('daily', 'up', 'bullish', 'below');
    expect(set(earlyBullCross, bull('weekly'), bull('monthly'))).toBe('中期偏多（短线分歧）');

    const unknownDaily = {
      ...bull('daily'),
      macd: { ...bull('daily').macd, availability: 'insufficient-history' as const },
    };
    expect(set(unknownDaily, bull('weekly'), bull('monthly'))).toBe('待确认');
  });

  it('builds one concise combined BOLL/MACD condition per period from the current confirmed bar', () => {
    const makeSnapshot = (interval: 'daily' | 'weekly' | 'monthly') => calculateTechnicalStateSnapshot(
      { ...series(), interval },
      bollStateConfigFor(interval),
    );
    const dailyBase = makeSnapshot('daily');
    const weeklyBase = makeSnapshot('weekly');
    const monthlyBase = makeSnapshot('monthly');
    const daily = {
      ...dailyBase,
      boll: { ...dailyBase.boll, bandwidthPhase: 'contracting' as const, middleDirection: 'up' as const },
      macd: { ...dailyBase.macd, crossEvent: 'golden' as const, arrangement: 'new-golden' as const },
    };
    const weekly = {
      ...weeklyBase,
      boll: { ...weeklyBase.boll, bandwidthPhase: 'expanding-persistent' as const, middleDirection: 'turning-down' as const },
      macd: { ...weeklyBase.macd, crossEvent: 'death' as const, arrangement: 'new-death' as const },
    };
    const monthly = {
      ...monthlyBase,
      boll: { ...monthlyBase.boll, bandwidthPhase: 'flat' as const, middleDirection: 'flat' as const },
      // A previous golden cross is history, not a new cross on the latest confirmed bar.
      macd: { ...monthlyBase.macd, crossEvent: 'none' as const, lastCross: 'golden' as const },
    };
    const description = describeTechnicalMultiTimeframeState({ daily, weekly, monthly });
    expect(description.summary).toBe(
      '日线：收口＋中轨向上＋MACD金叉；周线：持续开口＋中轨拐头向下＋MACD死叉；月线：带宽走平＋中轨走平＋MACD无新交叉。',
    );
    expect(description.summary).not.toContain('MACD金叉后');
    expect(description.periods).toHaveLength(3);
    expect(description.periods.find((period) => period.label === '周线')?.macd).toContain('死叉');
    expect(description.detail).toContain('不构成买卖方向或交易指令');
  });

  it('preserves MACD cross-history uncertainty in the compact summary', () => {
    const base = calculateTechnicalStateSnapshot(series());
    const daily = {
      ...base,
      interval: 'daily' as const,
      macd: { ...base.macd, interval: 'daily' as const, crossEvent: 'unknown' as const, arrangement: 'bull-history-unknown' as const },
    };
    const weekly = {
      ...base,
      interval: 'weekly' as const,
      macd: { ...base.macd, interval: 'weekly' as const, crossEvent: 'unknown' as const, arrangement: 'bear-history-unknown' as const },
    };
    const monthly = {
      ...base,
      interval: 'monthly' as const,
      macd: { ...base.macd, interval: 'monthly' as const },
    };

    const description = describeTechnicalMultiTimeframeState({ daily, weekly, monthly });
    expect(description.summary).toContain('MACD交叉未确认');
    expect(description.summary).not.toContain('多头排列·交叉历史不足');
    expect(description.summary).not.toContain('空头排列·交叉历史不足');
    expect(description.periods.find((period) => period.label === '日线')?.macd).toContain('多头排列·交叉历史不足');
    expect(description.periods.find((period) => period.label === '周线')?.macd).toContain('空头排列·交叉历史不足');
  });

  it('reports BOLL and MACD validity independently when one indicator lacks sufficient history', () => {
    const short = calculateTechnicalStateSnapshot(series('东方财富', 100));
    const full = calculateTechnicalStateSnapshot(series());
    const periods = {
      daily: short,
      weekly: { ...full, interval: 'weekly' as const, macd: { ...full.macd, interval: 'weekly' as const } },
      monthly: { ...full, interval: 'monthly' as const, macd: { ...full.macd, interval: 'monthly' as const } },
    };
    const summary = describeTechnicalMultiTimeframeState(periods).summary;
    expect(summary).toContain('日线：BOLL未配置＋MACD历史不足');
    expect(summary).toContain('周线：BOLL未配置＋MACD无新交叉');
    expect(summary).not.toContain('BOLL 有效');
  });

  it('distinguishes a configured but unconfirmed BOLL state from missing configuration', () => {
    const configured = calculateTechnicalStateSnapshot(series(), bollStateConfigFor('daily'));
    const configuredUnknown = {
      ...configured,
      boll: { ...configured.boll, bandwidthPhase: 'unknown' as const, middleDirection: 'unknown' as const, priceLocation: 'unknown' as const },
    };
    const unconfigured = calculateTechnicalStateSnapshot(series());
    const description = describeTechnicalMultiTimeframeState({
      daily: configuredUnknown,
      weekly: { ...unconfigured, interval: 'weekly' as const, macd: { ...unconfigured.macd, interval: 'weekly' as const } },
      monthly: { ...unconfigured, interval: 'monthly' as const, macd: { ...unconfigured.macd, interval: 'monthly' as const } },
    });
    expect(description.periods[0].boll).toContain('未确认');
    expect(description.periods[0].boll).not.toContain('未配置');
    expect(describeTechnicalStateSnapshot(configuredUnknown)).toContain('带宽阶段 未确认');
    expect(description.periods[1].boll).toContain('未配置');
    expect(description.summary).toContain('带宽未确认＋中轨未确认');
    expect(description.summary).toContain('BOLL未配置');
  });

  it('keeps insufficient, unavailable and invalid MACD detail descriptions distinct', () => {
    const insufficient = calculateTechnicalStateSnapshot(series('东方财富', 100));
    const insufficientDetail = describeTechnicalStateSnapshot(insufficient);
    expect(insufficientDetail).toContain('MACD 历史不足');
    expect(insufficientDetail).not.toContain('MACD 数据不可用');

    const unavailable = unavailableTechnicalState('daily', 'UNAVAILABLE', '缺少可信行情日期');
    expect(describeTechnicalStateSnapshot(unavailable)).toContain('MACD 数据不可用：缺少可信行情日期');

    const invalid = unavailableTechnicalState('daily', 'INVALID', '收盘价无效');
    expect(describeTechnicalStateSnapshot(invalid)).toContain('MACD 数据无效：收盘价无效');
  });

  it('does not turn unavailable MACD data into a neutral or no-cross state', () => {
    const full = calculateTechnicalStateSnapshot(series());
    const unavailable = {
      ...full,
      interval: 'monthly' as const,
      macd: {
        ...full.macd,
        interval: 'monthly' as const,
        availability: 'unavailable' as const,
        error: '缺少可信行情日期',
        crossEvent: 'unknown' as const,
      },
    };
    const description = describeTechnicalMultiTimeframeState({
      daily: full,
      weekly: { ...full, interval: 'weekly' as const, macd: { ...full.macd, interval: 'weekly' as const } },
      monthly: unavailable,
    });
    expect(description.summary).toContain('月线：BOLL未配置＋MACD不可用');
    expect(description.periods.find((period) => period.label === '月线')?.macd).toContain('数据不可用：缺少可信行情日期');
  });

  it('keeps MACD formula history available below the stable-state publication gate', () => {
    const snapshot = calculateTechnicalStateSnapshot(series('东方财富', 100));
    expect(snapshot.macd.availability).toBe('insufficient-history');
    expect(snapshot.macdHistory).toHaveLength(100);
    expect(snapshot.macdHistory.at(-1)?.formulaReady).toBe(true);
    expect(snapshot.macdHistory.at(-1)?.dif).toBeDefined();
  });

  it('keeps BOLL and MACD history rows aligned to the same confirmed dates', () => {
    const input = series();
    const snapshot = calculateTechnicalStateSnapshot(input, bollStateConfigFor('daily'));
    expect(snapshot.bollHistory).toHaveLength(input.bars.length);
    expect(snapshot.macdHistory).toHaveLength(input.bars.length);
    expect(snapshot.bollHistory.map((point) => point.date)).toEqual(input.bars.map((bar) => bar.date));
    expect(snapshot.macdHistory.map((point) => point.date)).toEqual(input.bars.map((bar) => bar.date));
  });

  it('distinguishes unavailable source data from invalid indicator input', () => {
    const snapshot = unavailableTechnicalState('daily', 'UNAVAILABLE', '缺少可信交易日期');
    expect(snapshot.validity).toBe('UNAVAILABLE');
    expect(snapshot.boll.validity).toBe('UNAVAILABLE');
    expect(snapshot.macd.availability).toBe('unavailable');
    const summary = describeTechnicalMultiTimeframeState({
      daily: snapshot,
      weekly: calculateTechnicalStateSnapshot(series()),
      monthly: calculateTechnicalStateSnapshot(series()),
    }).summary;
    expect(summary).toContain('日线：BOLL不可用＋MACD不可用');
  });

});

import type { ConfirmedTechnicalSeries } from './types';

export interface TechnicalReplayEntry<T> {
  interval: ConfirmedTechnicalSeries['interval'];
  asOfDate: string;
  confirmedBarCount: number;
  series: ConfirmedTechnicalSeries;
  result: T;
}

export interface ReplayComparison<T> {
  batchResult: T;
  replayResult: T;
  matches: boolean;
}

/** Replay one confirmed bar at a time. Each callback sees only the prefix ending at asOfDate. */
export function replayConfirmedTechnicalSeries<T>(
  source: ConfirmedTechnicalSeries,
  calculate: (prefix: ConfirmedTechnicalSeries) => T,
): TechnicalReplayEntry<T>[] {
  const entries: TechnicalReplayEntry<T>[] = [];
  for (let index = 0; index < source.bars.length; index += 1) {
    const bars = source.bars.slice(0, index + 1);
    const prefix: ConfirmedTechnicalSeries = {
      ...source,
      asOfDate: bars[bars.length - 1].date,
      bars,
      excludedInProgressBar: false,
    };
    entries.push({
      interval: prefix.interval,
      asOfDate: prefix.asOfDate,
      confirmedBarCount: bars.length,
      series: prefix,
      result: calculate(prefix),
    });
  }
  return entries;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableSerialize(record[key])).join(',') + '}';
}

/** Compare the normal full-series result with the final result produced by the same-start replay. */
export function compareBatchWithReplay<T>(
  source: ConfirmedTechnicalSeries,
  calculate: (series: ConfirmedTechnicalSeries) => T,
): ReplayComparison<T> | undefined {
  const replay = replayConfirmedTechnicalSeries(source, calculate);
  const last = replay[replay.length - 1];
  if (!last) return undefined;
  const batchResult = calculate(source);
  return {
    batchResult,
    replayResult: last.result,
    matches: stableSerialize(batchResult) === stableSerialize(last.result),
  };
}

/** Verify that every replay callback received only bars up to and including its own as-of date. */
export function hasNoFutureBars(entries: readonly TechnicalReplayEntry<unknown>[]): boolean {
  return entries.every((entry) =>
    entry.series.asOfDate === entry.asOfDate &&
    entry.series.bars.length === entry.confirmedBarCount &&
    entry.series.bars[entry.series.bars.length - 1]?.date === entry.asOfDate &&
    entry.series.bars.every((bar) => bar.date <= entry.asOfDate),
  );
}

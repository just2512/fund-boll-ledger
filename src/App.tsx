import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { bollRangePositionRatio, bollRangePositionRatioForBands, calculatePosition, compareToBases, currentValueCents, estimateCommission, estimateOtherFee, PRICE_KEYS, priceLadder, unrealizedPnlCents, type Direction, type PriceKey } from './calculations';
import { formatCents, formatCurrency, formatPercent, formatScaled, parseMoneyCents, parseQuantity, parseScaled, percentHundredths, priceAmountCents } from './decimal';
import { loadAppData, loadStorageMetadata, saveAppData, saveLastBackupAt } from './storage';
import { getBackupReminder } from './backup-reminder';
import { validateAppData } from './backup-validation';
import { fetchLatestMarketData, type MarketQuote } from './market-data';
import { MACD_STABILITY_MIN_BARS, macdArrangementLabel, macdMomentumLabel, macdZeroAxisLabel, type MacdMultiTimeframeState, type MacdPeriodState, type MacdTone } from './macd';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { TechnicalMultiTimeframeState, TechnicalStateSnapshot } from './technical-state/types';
import { describeTechnicalMultiTimeframeState } from './technical-state/engine';

import { createId, emptyAppData, newFund, type AppData, type Fund, type FundCategory, type FundPrices, type LadderDirection, type PriceBasisKey, type PriceSnapshot, type Trade, type TradeSide } from './types';

const NAV_ITEMS = [
  { id: 'calculator', label: '价格计算', caption: 'BOLL 与十档定位' },
  { id: 'ledger', label: '交易账本', caption: '逐笔买卖与费用' },
  { id: 'portfolio', label: '持仓盈亏', caption: '成本与已实现盈亏' },
  { id: 'history', label: '历史与备份', caption: '价格快照与数据迁移' },
] as const;
type PageId = (typeof NAV_ITEMS)[number]['id'];
type QuoteViewState = { requestedCode: string; status: 'loading' | 'success' | 'error'; quote?: MarketQuote; message?: string; hasManualEdits?: boolean; token?: number };
let quoteRequestToken = 0;
const CATEGORY_OPTIONS: FundCategory[] = ['ETF', 'LOF', '债券ETF', '货币ETF', '其他场内基金'];
const EMPTY_TRADE = {
  tradedAt: localDateTime(), side: 'BUY' as TradeSide, price: '', quantity: '',
  commission: '', transferFee: '', stampDuty: '', otherFee: '', feesChecked: false, note: '',
};

function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function dateOf(value: string): string {
  return value ? value.slice(0, 10) : '';
}
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
}

// Tauri WebViews silently drop <a download> navigation, so packaged apps must write
// through the dialog+fs plugins; plain browsers (optional PWA preview) keep the anchor path.
async function saveFile(name: string, body: string, type = 'application/json;charset=utf-8'): Promise<boolean> {
  if (!isTauriEnv()) {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    return true;
  }
  const path = await saveDialog({
    defaultPath: name,
    filters: [{ name: name.endsWith('.csv') ? 'CSV 文件' : 'JSON 备份', extensions: [name.endsWith('.csv') ? 'csv' : 'json'] }],
  });
  if (!path) return false; // user cancelled the save dialog
  await writeTextFile(path, body);
  return true;
}

// Mirrors saveFile: packaged apps pick the backup file through the dialog plugin.
async function openFileViaDialog(): Promise<string | null> {
  if (!isTauriEnv()) return null;
  const picked = await openDialog({
    multiple: false,
    filters: [{ name: 'JSON 备份', extensions: ['json'] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  return await readTextFile(picked);
}



function escapeCsv(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function normalizeAppData(value: AppData): AppData {
  const allowedBases: PriceBasisKey[] = ['upper', 'middle', 'lower', 'previousClose', 'lastTradePrice'];
  const funds = value.funds.map((source) => {
    const fund = { ...source } as Fund & {
      commissionRatePercent?: string;
      minimumCommission?: string;
      applyMinimumCommission?: boolean;
    };
    delete fund.commissionRatePercent;
    delete fund.minimumCommission;
    delete fund.applyMinimumCommission;
    const ladderBasis: PriceBasisKey = allowedBases.includes(fund.ladderBasis) ? fund.ladderBasis : 'lastTradePrice';
    const ladderDirection: LadderDirection = fund.ladderDirection === 'down' ? 'down' : 'up';
    return { ...fund, ladderBasis, ladderDirection };
  });
  return { ...value, funds };
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: 'up' | 'down' | 'neutral'; hint?: string }) {
  return <div className="metric"><span className="muted metric-label">{label}</span><strong className={tone === 'up' ? 'positive' : tone === 'down' ? 'negative' : ''}>{value}</strong>{hint && <small className="muted">{hint}</small>}</div>;
}
function Field({ label, value, onChange, placeholder, type = 'text', step, min, suffix, help, disabled }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; step?: string; min?: string; suffix?: string; help?: string; disabled?: boolean;
}) {
  return <label className="field"><span>{label}</span><div className="input-wrap"><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} step={step} min={min} disabled={disabled} /><>{suffix && <em>{suffix}</em>}</></div>{help && <small className="muted">{help}</small>}</label>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>{children}</section></div>;
}

function FundForm({ initial, onSave, onCancel }: { initial?: Fund; onSave: (fund: Fund) => void; onCancel: () => void }) {
  const [value, setValue] = useState<Fund>(() => initial ? structuredClone(initial) : newFund());
  const patch = <K extends keyof Fund>(key: K, next: Fund[K]) => setValue((old) => ({ ...old, [key]: next }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.name.trim()) { window.alert('请填写基金名称。'); return; }
    try { if (!value.tickSize.trim() || parseScaled(value.tickSize) <= 0n) throw new Error(); } catch { window.alert('最小价格变动单位必须为正数，例如 0.001。'); return; }
    onSave({ ...value, name: value.name.trim(), code: value.code.trim(), updatedAt: new Date().toISOString() });
  };
  return <Modal title={initial ? '编辑基金档案' : '新增基金档案'} onClose={onCancel} wide><form onSubmit={submit} className="form-stack">
    <div className="form-grid two"><Field label="基金名称（必填）" value={value.name} onChange={(v) => patch('name', v)} placeholder="例如：宽基 ETF"/><Field label="基金代码（可选）" value={value.code} onChange={(v) => patch('code', v)} placeholder="例如：510300"/></div>
    <div className="form-grid three"><label className="field"><span>基金类别</span><select value={value.category} onChange={(e) => patch('category', e.target.value as FundCategory)}>{CATEGORY_OPTIONS.map((x) => <option key={x}>{x}</option>)}</select></label><label className="field"><span>交易市场</span><select value={value.market} onChange={(e) => patch('market', e.target.value as Fund['market'])}><option>沪市</option><option>深市</option><option>其他/未确认</option></select></label><Field label="最小价格变动单位" value={value.tickSize} onChange={(v) => patch('tickSize', v)} placeholder="0.001" help="默认 0.001 元，可按具体基金规则修改。"/></div>
    <div className="section-divider"/><div><h3>统一费用规则（全局固定）</h3><p className="muted small">所有基金共用：佣金 0.015%，其他费用 0.004%，两项均按分四舍五入；此处不再单独配置费率。</p></div>
    <Field label="档案备注" value={value.notes} onChange={(v) => patch('notes', v)} placeholder="自定义说明（可选）"/>
    <div className="modal-actions"><button type="button" className="button ghost" onClick={onCancel}>取消</button><button type="submit" className="button primary">保存档案</button></div>
  </form></Modal>;
}

function TradeForm({ fund, initial, onSave, onCancel }: { fund: Fund; initial?: Trade; onSave: (trade: Trade) => void; onCancel: () => void }) {
  const [form, setForm] = useState(() => initial ? {
    tradedAt: initial.tradedAt, side: initial.side, price: initial.price, quantity: initial.quantity,
    commission: initial.commission, transferFee: initial.transferFee, stampDuty: initial.stampDuty, otherFee: initial.otherFee, feesChecked: initial.feesChecked, note: initial.note,
  } : { ...EMPTY_TRADE });
  const patch = (key: keyof typeof form, value: string) => setForm((old) => ({ ...old, [key]: value }));
  // Per-field guard: once the user edits a fee field, the estimate stops overwriting THAT field
  // only; untouched fields keep auto-estimating. "按固定费率重算" clears the guard.
  const feesDirtyRef = useRef<Set<'commission' | 'transferFee' | 'stampDuty' | 'otherFee'>>(new Set());
  const patchFee = (key: 'commission' | 'transferFee' | 'stampDuty' | 'otherFee', value: string) => {
    feesDirtyRef.current.add(key);
    patch(key, value);
  };
  useEffect(() => {
    if (initial) return;
    const dirty = feesDirtyRef.current;
    if (!form.price.trim() || !form.quantity.trim()) {
      setForm((old) => {
        const next = { ...old };
        if (!dirty.has('commission') && next.commission) next.commission = '';
        if (!dirty.has('otherFee') && next.otherFee) next.otherFee = '';
        return next.commission === old.commission && next.otherFee === old.otherFee ? old : next;
      });
      return;
    }
    try {
      const commission = estimateCommission(form.price, form.quantity);
      const otherFee = estimateOtherFee(form.price, form.quantity);
      setForm((old) => {
        if (old.price !== form.price || old.quantity !== form.quantity) return old;
        const next = { ...old };
        if (!dirty.has('commission')) next.commission = commission;
        if (!dirty.has('otherFee')) next.otherFee = otherFee;
        return next.commission === old.commission && next.otherFee === old.otherFee ? old : next;
      });
    } catch {
      setForm((old) => {
        const next = { ...old };
        if (!dirty.has('commission') && next.commission) next.commission = '';
        if (!dirty.has('otherFee') && next.otherFee) next.otherFee = '';
        return next.commission === old.commission && next.otherFee === old.otherFee ? old : next;
      });
    }
  }, [initial, form.price, form.quantity]);
  const grossCents = useMemo(() => {
    try { return form.price.trim() && form.quantity.trim() ? priceAmountCents(form.price, form.quantity) : 0n; } catch { return 0n; }
  }, [form.price, form.quantity]);
  const feeCents = useMemo(() => {
    try { return parseMoneyCents(form.commission) + parseMoneyCents(form.transferFee) + parseMoneyCents(form.stampDuty) + parseMoneyCents(form.otherFee); } catch { return 0n; }
  }, [form.commission, form.transferFee, form.stampDuty, form.otherFee]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!form.tradedAt) throw new Error('请选择成交日期和时间。');
      if (parseScaled(form.price) <= 0n) throw new Error('成交价格必须大于零。');
      if (parseQuantity(form.quantity) <= 0n) throw new Error('成交数量必须为正整数。');
      for (const fee of [form.commission, form.transferFee, form.stampDuty, form.otherFee]) if (fee.trim() && parseMoneyCents(fee) < 0n) throw new Error('费用不能为负数。');
      onSave({
        id: initial?.id ?? createId(), fundId: fund.id, tradedAt: form.tradedAt, side: form.side as TradeSide,
        price: form.price.trim(), quantity: form.quantity.trim(), commission: form.commission || '0', transferFee: form.transferFee || '0', stampDuty: form.stampDuty || '0', otherFee: form.otherFee || '0', feesChecked: form.feesChecked, note: form.note.trim(),
        createdAt: initial?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    } catch (error) { window.alert(error instanceof Error ? error.message : '交易数据无效。'); }
  };
  const fillEstimatedFees = () => {
    try {
      const commission = estimateCommission(form.price, form.quantity);
      const otherFee = estimateOtherFee(form.price, form.quantity);
      if (!commission || !otherFee) throw new Error();
      setForm((old) => ({ ...old, commission, otherFee }));
    } catch {
      window.alert('请先填写有效的成交价格和成交数量，再计算固定费用。');
    }
  };
  const resetAndFillFees = () => {
    feesDirtyRef.current.clear();
    fillEstimatedFees();
  };
  return <Modal title={initial ? '编辑交易记录' : '新增交易记录'} onClose={onCancel} wide><form className="form-stack" onSubmit={submit}>
    <div className="trade-side-switch"><button type="button" className={form.side === 'BUY' ? 'active buy' : ''} onClick={() => patch('side', 'BUY')}>买入</button><button type="button" className={form.side === 'SELL' ? 'active sell' : ''} onClick={() => patch('side', 'SELL')}>卖出</button></div>
    <div className="form-grid two"><Field label="成交日期和时间" value={form.tradedAt} onChange={(v) => patch('tradedAt', v)} type="datetime-local"/><Field label="成交价格（元/份）" value={form.price} onChange={(v) => patch('price', v)} placeholder="0.000" type="number" step="any" min="0"/></div>
    <div className="form-grid two"><Field label="成交数量（份，整数）" value={form.quantity} onChange={(v) => patch('quantity', v)} placeholder="例如 1000" type="number" step="1" min="1"/><div className="amount-preview"><span className="muted">成交金额（自动计算）</span><strong>{formatCurrency(grossCents)}</strong></div></div>
    <div className="section-divider"/><div className="fee-heading"><div><h3>交易费用（元）</h3><p className="muted small">佣金 0.015%、其他费用 0.004%，按分四舍五入自动估算；经手/过户费与印花税按实际发生填写。保存前请核对成交明细。</p></div><button type="button" className="button small-button" onClick={resetAndFillFees}>按固定费率重算</button></div>
    <div className="form-grid four"><Field label="佣金（0.015%）" value={form.commission} onChange={(v) => patchFee('commission', v)} placeholder="自动计算" type="number" step="0.01" min="0"/><Field label="经手/过户等费用" value={form.transferFee} onChange={(v) => patchFee('transferFee', v)} placeholder="按实际填写" type="number" step="0.01" min="0"/><Field label="印花税" value={form.stampDuty} onChange={(v) => patchFee('stampDuty', v)} placeholder="按实际填写" type="number" step="0.01" min="0"/><Field label="其他费用（0.004%）" value={form.otherFee} onChange={(v) => patchFee('otherFee', v)} placeholder="自动计算" type="number" step="0.01" min="0"/></div>
    <div className="fee-verification"><input id="fees-checked" type="checkbox" checked={form.feesChecked} onChange={(e) => setForm((old) => ({ ...old, feesChecked: e.target.checked }))}/><label htmlFor="fees-checked">我已对照东方财富实际成交明细核对本笔费用（没有发生的费用填 0；未核对时不要勾选）</label></div>
    <div className="cost-summary"><span>费用合计 <strong>{formatCurrency(feeCents)}</strong></span><span>{form.side === 'BUY' ? '买入现金支出' : '卖出现金净收入'} <strong>{formatCurrency(form.side === 'BUY' ? grossCents + feeCents : grossCents - feeCents)}</strong></span></div>
    <Field label="交易备注" value={form.note} onChange={(v) => patch('note', v)} placeholder="例如：参考 BOLL 下轨买入（可选）"/>
    <div className="modal-actions"><button type="button" className="button ghost" onClick={onCancel}>取消</button><button type="submit" className="button primary">保存交易</button></div>
  </form></Modal>;
}

export default function App() {
  const [data, setData] = useState<AppData>(emptyAppData);
  const [hydrated, setHydrated] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [persistenceError, setPersistenceError] = useState('');
  const [activePage, setActivePage] = useState<PageId>('calculator');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFundId, setSelectedFundId] = useState('');
  const [showFundForm, setShowFundForm] = useState(false);
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [marketQuotes, setMarketQuotes] = useState<Record<string, QuoteViewState>>({});
  const [historyFundFilter, setHistoryFundFilter] = useState('all');
  const [notification, setNotification] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    loadAppData().then(async (loaded) => {
      let backupTimestamp: string | null = null;
      try { backupTimestamp = (await loadStorageMetadata()).lastBackupAt; } catch { /* Ledger data remains readable; the reminder will fail safe to due. */ }
      if (!active) return;
      const normalized = normalizeAppData(loaded);
      setData(normalized);
      setLastBackupAt(backupTimestamp);
      setSelectedFundId(normalized.funds[0]?.id ?? '');
      setHydrated(true);
      setStorageReady(true);
      setPersistenceStatus('saved');
    }).catch((error: unknown) => {
      if (!active) return;
      setHydrated(true);
      setStorageReady(false);
      setPersistenceStatus('error');
      setPersistenceError(error instanceof Error ? error.message : '无法读取本地数据');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!notification) return;
    const handle = window.setTimeout(() => setNotification(''), 3800);
    return () => window.clearTimeout(handle);
  }, [notification]);

  useEffect(() => {
    if (!hydrated || !storageReady) return;
    setPersistenceStatus('saving');
    const handle = window.setTimeout(() => {
      saveAppData(data).then(() => { setPersistenceStatus('saved'); setPersistenceError(''); }).catch((error: unknown) => {
        setPersistenceStatus('error'); setPersistenceError(error instanceof Error ? error.message : '保存本地数据失败');
      });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [data, hydrated, storageReady]);

  const selectedFund = useMemo(() => data.funds.find((fund) => fund.id === selectedFundId) ?? null, [data.funds, selectedFundId]);
  const backupReminder = useMemo(
    () => getBackupReminder(lastBackupAt, data.funds.length > 0 || data.trades.length > 0 || data.snapshots.length > 0),
    [lastBackupAt, data.funds.length, data.trades.length, data.snapshots.length],
  );
  const storedQuoteState = selectedFund ? marketQuotes[selectedFund.id] : undefined;
  const currentQuoteState = storedQuoteState?.requestedCode === selectedFund?.code ? storedQuoteState : undefined;
  const ladderBasis: PriceKey = selectedFund?.ladderBasis ?? 'lastTradePrice';
  const ladderDirection: Direction = selectedFund?.ladderDirection ?? 'up';
  const setLadderBasis = useCallback((basis: PriceKey) => {
    setData((old) => ({ ...old, funds: old.funds.map((fund) => fund.id === selectedFundId ? { ...fund, ladderBasis: basis } : fund) }));
  }, [selectedFundId]);
  const setLadderDirection = useCallback((direction: Direction) => {
    setData((old) => ({ ...old, funds: old.funds.map((fund) => fund.id === selectedFundId ? { ...fund, ladderDirection: direction } : fund) }));
  }, [selectedFundId]);
  const selectedFundIndex = data.funds.findIndex((fund) => fund.id === selectedFundId);
  const allTrades = useMemo(() => data.trades.slice().sort((a, b) => b.tradedAt.localeCompare(a.tradedAt) || b.createdAt.localeCompare(a.createdAt)), [data.trades]);
  const position = useMemo(() => selectedFund ? calculatePosition(data.trades, selectedFund.id) : null, [data.trades, selectedFund]);
  const comparisons = useMemo(() => selectedFund ? compareToBases(selectedFund.prices, selectedFund.tickSize) : [], [selectedFund]);
  const ladderRows = useMemo(() => {
    if (!selectedFund) return [];
    try { return priceLadder(selectedFund.prices[ladderBasis], selectedFund.tickSize, ladderDirection, selectedFund.prices.currentPrice); }
    catch { return []; }
  }, [selectedFund, ladderBasis, ladderDirection]);

  const mutatePrices = useCallback((id: string, patch: Partial<FundPrices>) => {
    setData((old) => ({ ...old, funds: old.funds.map((fund) => fund.id === id ? { ...fund, prices: { ...fund.prices, ...patch }, updatedAt: new Date().toISOString() } : fund) }));
  }, []);

  const handleSaveFund = (fund: Fund) => {
    setData((old) => ({ ...old, funds: old.funds.some((f) => f.id === fund.id) ? old.funds.map((f) => f.id === fund.id ? fund : f) : [...old.funds, fund] }));
    setSelectedFundId(fund.id);
    setShowFundForm(false);
    setEditingFundId(null);
    setNotification(`已保存基金档案：${fund.name}`);
  };

  const lastTradePriceForFund = (fundId: string) => data.trades.filter((trade) => trade.fundId === fundId).slice().sort((a, b) => b.tradedAt.localeCompare(a.tradedAt) || b.createdAt.localeCompare(a.createdAt))[0]?.price ?? '';

  const handleSaveTrade = (trade: Trade) => {
    const trialTrades = [...data.trades.filter((t) => t.id !== trade.id), trade];
    const trialPosition = calculatePosition(trialTrades, trade.fundId);
    if (trialPosition.error) { window.alert(`没有保存交易。\n${trialPosition.error}\n\n请核对成交时间、数量和此前的买入记录。`); return; }
    const latest = trialTrades.filter((t) => t.fundId === trade.fundId).slice().sort((a, b) => b.tradedAt.localeCompare(a.tradedAt) || b.createdAt.localeCompare(a.createdAt))[0];
    setData((old) => ({ ...old, trades: trialTrades, funds: old.funds.map((fund) => fund.id === trade.fundId && latest ? { ...fund, prices: { ...fund.prices, lastTradePrice: latest.price }, updatedAt: new Date().toISOString() } : fund) }));
    setShowTradeForm(false);
    setEditingTradeId(null);
    setNotification('交易明细已保存，持仓与盈亏已重新计算。');
  };

  const handleDeleteTrade = (trade: Trade) => {
    if (!window.confirm(`确定删除 ${trade.tradedAt} 的${trade.side === 'BUY' ? '买入' : '卖出'}记录吗？删除后持仓和盈亏会重新计算。`)) return;
    const nextTrades = data.trades.filter((t) => t.id !== trade.id);
    const summary = calculatePosition(nextTrades, trade.fundId);
    if (summary.error) { window.alert(`删除后历史账本出现问题：${summary.error}`); return; }
    const latest = nextTrades.filter((t) => t.fundId === trade.fundId).slice().sort((a, b) => b.tradedAt.localeCompare(a.tradedAt) || b.createdAt.localeCompare(a.createdAt))[0];
    setData((old) => ({ ...old, trades: nextTrades, funds: old.funds.map((fund) => fund.id === trade.fundId ? { ...fund, prices: { ...fund.prices, lastTradePrice: latest?.price ?? '' }, updatedAt: new Date().toISOString() } : fund) }));
    setNotification('交易记录已删除并重新计算。');
  };

  const handleDeleteFund = () => {
    if (!selectedFund) return;
    const count = data.trades.filter((t) => t.fundId === selectedFund.id).length;
    if (!window.confirm(`确定删除基金“${selectedFund.name}”及其 ${count} 笔交易、全部价格快照吗？此操作无法撤销，请先备份。`)) return;
    const next = { ...data, funds: data.funds.filter((f) => f.id !== selectedFund.id), trades: data.trades.filter((t) => t.fundId !== selectedFund.id), snapshots: data.snapshots.filter((s) => s.fundId !== selectedFund.id) };
    setData(next);
    setSelectedFundId(next.funds[0]?.id ?? '');
    // The deleted fund's snapshots vanish; a stale filter would show an empty list for no reason.
    if (historyFundFilter !== 'all' && !next.funds.some((f) => f.id === historyFundFilter)) setHistoryFundFilter('all');
    setNotification('基金档案及其关联记录已删除。');
  };

  const handleSaveSnapshot = () => {
    if (!selectedFund) return;
    const now = new Date();
    const snapshot: PriceSnapshot = {
      id: createId(), fundId: selectedFund.id, createdAt: now.toISOString(), tradingDate: dateOf(localDateTime(now)),
      prices: structuredClone(selectedFund.prices), tickSize: selectedFund.tickSize, note: snapshotNote.trim(),
    };
    setData((old) => ({ ...old, snapshots: [...old.snapshots, snapshot] }));
    setSnapshotNote('');
    setNotification(`已保存 ${snapshot.tradingDate} 的价格快照。`);
  };

  const refreshMarketQuote = async (fund: Fund) => {
    // Snapshot the fund's inputs at request start; the response may only overwrite
    // fields the user has not touched while this request was in flight.
    const priorPrices = { ...fund.prices };
    const fundIdBefore = fund.id;
    // Request token: only the newest request may write quote state back; a stale
    // response (e.g. after editing the fund code mid-flight) must not clobber it.
    const token = ++quoteRequestToken;
    setMarketQuotes((old) => ({
      ...old,
      [fund.id]: {
        requestedCode: fund.code,
        status: 'loading',
        quote: old[fund.id]?.requestedCode === fund.code ? old[fund.id]?.quote : undefined,
        hasManualEdits: old[fund.id]?.requestedCode === fund.code ? old[fund.id]?.hasManualEdits : undefined,
        token,
      },
    }));
    try {
      const quote = await fetchLatestMarketData({ code: fund.code, market: fund.market });
      setData((old) => ({
        ...old,
        funds: old.funds.map((item) => {
          if (item.id !== fundIdBefore || item.code !== fund.code) return item;
          return {
            ...item,
            prices: {
              ...item.prices,
              currentPrice: item.prices.currentPrice === priorPrices.currentPrice ? quote.price : item.prices.currentPrice,
              previousClose: item.prices.previousClose === priorPrices.previousClose ? quote.previousClose : item.prices.previousClose,
              ...(quote.boll && item.prices.upper === priorPrices.upper && item.prices.middle === priorPrices.middle && item.prices.lower === priorPrices.lower
                ? { upper: quote.boll.upper, middle: quote.boll.middle, lower: quote.boll.lower }
                : {}),
            },
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      setMarketQuotes((old) => {
        const prior = old[fundIdBefore];
        if (prior && prior.token !== undefined && prior.token !== token) return old; // a newer request owns the slot
        // Keep the manual-edit flag when the user edited during the request; the hint must stay honest.
        const keepManualEdits = prior?.requestedCode === fund.code && prior.hasManualEdits === true;
        return { ...old, [fundIdBefore]: { requestedCode: fund.code, status: 'success', quote, hasManualEdits: keepManualEdits, token } };
      });
      const bollFailureNotes = [quote.bollError ? '日 BOLL 未更新，原日轨道价格已保留。' : '', quote.weeklyBollRangeError ? '周 BOLL 未更新。' : '', quote.monthlyBollRangeError ? '月 BOLL 未更新。' : ''].filter(Boolean).join(' ');
      setNotification('已刷新 ' + fund.name + ' 最新价、昨收' + (quote.boll || quote.weeklyBollRange || quote.monthlyBollRange ? '及' + [quote.boll ? '日' : '', quote.weeklyBollRange ? '周' : '', quote.monthlyBollRange ? '月' : ''].filter(Boolean).join('、') + ' BOLL 区间位置数据' : '') + '（' + quote.source + '）。' + bollFailureNotes);
    } catch (error) {
      setMarketQuotes((old) => {
        const prior = old[fundIdBefore];
        if (prior && prior.token !== undefined && prior.token !== token) return old; // a newer request owns the slot
        return {
          ...old,
          [fundIdBefore]: {
            requestedCode: fund.code,
            status: 'error',
            quote: prior?.requestedCode === fund.code ? prior?.quote : undefined,
            hasManualEdits: prior?.requestedCode === fund.code ? prior?.hasManualEdits : undefined,
            message: error instanceof Error ? error.message : '行情获取失败。',
            token,
          },
        };
      });
    }
  };

  const exportJson = () => {
    const exportedAt = new Date().toISOString();
    void saveFile(`fund-boll-ledger-${exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2)).then((saved) => {
      setNotification(saved ? 'JSON 备份已导出，请确认保存位置。' : '导出已取消。');
    }).catch((error: unknown) => {
      setNotification('导出失败：' + (error instanceof Error ? error.message : '未知错误'));
    });
    setLastBackupAt(exportedAt);
    void saveLastBackupAt(exportedAt).catch((error: unknown) => {
      setNotification('已发起 JSON 导出，但无法记录备份提醒时间：' + (error instanceof Error ? error.message : '本地元数据保存失败'));
    });
  };
  const exportCsv = () => {
    const header = ['基金名称', '基金代码', '成交时间', '方向', '成交价格', '数量', '成交金额', '佣金', '经手/过户费用', '印花税', '其他费用', '费用合计', '费用是否核对', '备注'];
    const rows = data.trades.slice().sort((a, b) => a.tradedAt.localeCompare(b.tradedAt)).map((trade) => {
      const fund = data.funds.find((f) => f.id === trade.fundId);
      const gross = priceAmountCents(trade.price, trade.quantity);
      const fee = parseMoneyCents(trade.commission) + parseMoneyCents(trade.transferFee) + parseMoneyCents(trade.stampDuty) + parseMoneyCents(trade.otherFee);
      return [fund?.name ?? '（基金已删除）', fund?.code ?? '', trade.tradedAt, trade.side === 'BUY' ? '买入' : '卖出', trade.price, trade.quantity, formatCents(gross), trade.commission, trade.transferFee, trade.stampDuty, trade.otherFee, formatCents(fee), trade.feesChecked ? '已核对' : '待核对', trade.note];
    });
    const body = '\uFEFF' + [header, ...rows].map((row) => row.map((v) => escapeCsv(String(v))).join(',')).join('\r\n');
    void saveFile(`fund-trades-${new Date().toISOString().slice(0, 10)}.csv`, body, 'text/csv;charset=utf-8').then((saved) => {
      setNotification(saved ? 'CSV \u4EA4\u6613\u660E\u7EC6\u5DF2\u5BFC\u51FA\uFF0C\u8BF7\u786E\u8BA4\u4FDD\u5B58\u4F4D\u7F6E\u3002' : '\u5BFC\u51FA\u5DF2\u53D6\u6D88\u3002');
    }).catch((error: unknown) => {
      setNotification('\u5BFC\u51FA\u5931\u8D25\uFF1A' + (error instanceof Error ? error.message : '\u672A\u77E5\u9519\u8BEF'));
    });
  };

  const applyImportedBackup = (text: string) => {
    const parsed: unknown = JSON.parse(text);
    const validation = validateAppData(parsed);
    if (!validation.valid) throw new Error(`备份校验失败，未导入任何数据：\n- ${validation.errors.join('\n- ')}`);
    const backup = validation.data;
    if (!window.confirm(`备份文件含 ${backup.funds.length} 只基金、${backup.trades.length} 笔交易、${backup.snapshots.length} 条价格快照。导入将完全替换当前设备数据。请确认已导出现有数据。`)) return false;
    const normalized = normalizeAppData(backup);
    setData(normalized);
    // Imported data replaces the whole ledger; stale quote/progress state must not survive it.
    setMarketQuotes({});
    setSelectedFundId(normalized.funds[0]?.id ?? '');
    setHistoryFundFilter('all');
    setNotification(storageReady ? '备份已载入当前设备；保存状态确认后再关闭页面。' : '备份已载入内存，但本浏览器无法持久化（本地保存异常）；请在关闭页面前导出 JSON 备份。');
    return true;
  };

  const handleImportFile = async (file?: File) => {
    if (!file) return;
    try {
      applyImportedBackup(await file.text());
    } catch (error) { window.alert(error instanceof Error ? error.message : '无法读取备份文件。'); }
    finally { if (importInputRef.current) importInputRef.current.value = ''; }
  };

  // Packaged apps cannot open <input type=file> reliably either; pick through the dialog plugin.
  const handleImportClick = async () => {
    if (isTauriEnv()) {
      try {
        const text = await openFileViaDialog();
        if (text !== null) applyImportedBackup(text);
      } catch (error) { window.alert(error instanceof Error ? error.message : '无法读取备份文件。'); }
      return;
    }
    importInputRef.current?.click();
  };


  if (!hydrated) return <div className="loading-screen"><div className="brand-mark">阶</div><strong>基金阶梯账本</strong><p className="muted">正在读取本地账本……</p></div>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">阶</div><div><strong>基金阶梯账本</strong><span>手动记录 · 本地保存 · 不接交易接口</span></div></div>{selectedFund && <details className="top-summary"><summary><span className="top-summary-name">{selectedFund.name}</span><strong>{selectedFund.prices.currentPrice || '未录入现价'}</strong><span className="top-summary-hint">{currentQuoteState?.status === 'loading' ? '行情刷新中' : currentQuoteState?.quote ? currentQuoteState.quote.source + ' · ' + (currentQuoteState.quote.quotedAt || '源端未提供时间') : '展开行情摘要'}</span></summary><div className="top-summary-tray"><div><span>基金代码</span><strong>{selectedFund.code || '—'}</strong></div><div><span>当前价格</span><strong>{selectedFund.prices.currentPrice || '—'}</strong></div><div><span>报价来源</span><strong>{currentQuoteState?.quote?.source || '尚未刷新'}</strong></div><div><span>行情时间</span><strong>{currentQuoteState?.quote?.quotedAt || '源端未提供'}</strong></div><div className="top-summary-technical"><span>技术状态</span><strong>{currentQuoteState?.quote?.technicalState ? describeTechnicalMultiTimeframeState(currentQuoteState.quote.technicalState).summary : '等待有效行情数据'}</strong></div></div></details>}<div className="top-actions"><span className={`save-state ${persistenceStatus}`}><i/>{persistenceStatus === 'saving' ? '保存中' : persistenceStatus === 'saved' ? '已保存到本机' : persistenceStatus === 'error' ? '保存异常' : '读取中'}</span><button className="button ghost top-export" onClick={exportJson}>导出备份</button><button className="button ghost top-export" onClick={() => void handleImportClick()}>导入备份</button><input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => void handleImportFile(e.target.files?.[0])}/></div></header>
    {persistenceStatus === 'error' && <div className="storage-warning"><strong>本地保存异常：</strong>{persistenceError} 请先导出备份并检查浏览器权限。<button className="text-button" onClick={exportJson}>立即导出备份</button></div>}
    {backupReminder.due && <div className="storage-warning backup-reminder" role="status"><strong>本地备份提醒：</strong>{backupReminder.message} 账本仅保存在本机；导出后请将 JSON 文件另存到安全位置。<button className="text-button" onClick={exportJson}>立即导出完整 JSON</button></div>}
    <div className={`workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}><div className="sidebar-header"><span className="sidebar-label">工作台</span><button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed((old) => !old)} aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}>{sidebarCollapsed ? '☰' : '‹'}</button></div>{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${activePage === item.id ? 'selected' : ''}`} onClick={() => setActivePage(item.id)} title={sidebarCollapsed ? item.label : undefined} aria-label={item.label}><span className="nav-symbol">{item.id === 'calculator' ? '⌁' : item.id === 'ledger' ? '≡' : item.id === 'portfolio' ? '◫' : '↻'}</span><span><strong>{item.label}</strong><small>{item.caption}</small></span></button>)}<div className="sidebar-divider"/><div className="sidebar-funds-head"><span className="sidebar-label">我的基金</span><button className="round-add" onClick={() => { setEditingFundId(null); setShowFundForm(true); }} aria-label="新增基金">＋</button></div>{data.funds.length === 0 ? <div className="empty-funds">还没有基金档案。<br/>新增后即可开始计算。</div> : <div className="fund-list">{data.funds.map((fund) => <button key={fund.id} className={`fund-list-item ${fund.id === selectedFundId ? 'active' : ''}`} onClick={() => setSelectedFundId(fund.id)} aria-label={fund.name} title={sidebarCollapsed ? fund.name : undefined}><span className="fund-dot">{fund.name.slice(0, 1)}</span><span className="fund-list-text"><strong>{fund.name}</strong><small>{fund.code || fund.category}</small></span>{fund.id === selectedFundId && <span className="selected-mark">●</span>}</button>)}</div>}<button className="button outline full-width add-fund" onClick={() => { setEditingFundId(null); setShowFundForm(true); }}>＋ 新增基金</button><div className="sidebar-footer"><span>数据保存在当前浏览器设备</span><span>跨设备请使用备份导入导出</span></div></aside>
      <main className="main-content"><div className="page-heading"><div><div className="eyebrow">PERSONAL FUND WORKSPACE</div><h1>{NAV_ITEMS.find((x) => x.id === activePage)?.label}</h1><p>{NAV_ITEMS.find((x) => x.id === activePage)?.caption} · 行情可手动刷新，不自动轮询</p></div>{selectedFund && <div className="page-fund-tools"><div className="fund-selector-wrap"><label htmlFor="fund-select">当前基金</label><select id="fund-select" value={selectedFund.id} onChange={(e) => setSelectedFundId(e.target.value)}>{data.funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}{fund.code ? ` · ${fund.code}` : ''}</option>)}</select></div><div className="fund-navigation" role="group" aria-label="切换基金"><button type="button" className="icon-button fund-nav-button" aria-label="上一只基金" title="上一只基金" disabled={selectedFundIndex <= 0} onClick={() => { const previous = data.funds[selectedFundIndex - 1]; if (previous) setSelectedFundId(previous.id); }}>‹</button><button type="button" className="icon-button fund-nav-button" aria-label="下一只基金" title="下一只基金" disabled={selectedFundIndex < 0 || selectedFundIndex >= data.funds.length - 1} onClick={() => { const next = data.funds[selectedFundIndex + 1]; if (next) setSelectedFundId(next.id); }}>›</button></div><button className="button ghost" onClick={() => { setEditingFundId(null); setShowFundForm(true); }}>＋ 新增</button><button className="button ghost" onClick={() => { setEditingFundId(selectedFund.id); setShowFundForm(true); }}>编辑档案</button></div>}</div>
        {data.funds.length === 0 ? <section className="welcome-card"><div className="welcome-icon">阶</div><h2>先建立第一只场内基金</h2><p>手动输入布林线上轨、中轨、下轨、昨日收盘价、上一次成交价和当前价格，即可生成十档阶梯。交易账本会记录成交数量、费用、持仓和盈亏。</p><button className="button primary" onClick={() => { setEditingFundId(null); setShowFundForm(true); }}>＋ 新增基金档案</button><div className="welcome-feature-row"><span>手动刷新行情</span><span>不自动下单</span><span>本地保存</span><span>JSON 备份恢复</span></div></section> : !selectedFund ? null : <>
          {activePage === 'calculator' && <CalculatorPage fund={selectedFund} comparisons={comparisons} ladderBasis={ladderBasis} setLadderBasis={setLadderBasis} ladderDirection={ladderDirection} setLadderDirection={setLadderDirection} ladderRows={ladderRows} onPriceChange={(key, value) => { mutatePrices(selectedFund.id, { [key]: value }); setMarketQuotes((old) => { const prior = old[selectedFund.id]; if (!prior || prior.requestedCode !== selectedFund.code) return old; return { ...old, [selectedFund.id]: { ...prior, hasManualEdits: true } }; }); }} quoteState={currentQuoteState} onRefreshQuote={() => void refreshMarketQuote(selectedFund)} onUseLatestTrade={() => { const price = lastTradePriceForFund(selectedFund.id); if (price) mutatePrices(selectedFund.id, { lastTradePrice: price }); else setNotification('当前基金还没有交易记录，请手动输入上一次成交价。'); }} onSaveSnapshot={handleSaveSnapshot} snapshotNote={snapshotNote} setSnapshotNote={setSnapshotNote} onGoLedger={() => { setActivePage('ledger'); setShowTradeForm(true); }}/>}
          {activePage === 'ledger' && <LedgerPage fund={selectedFund} funds={data.funds} trades={allTrades} position={position!} onAdd={() => { setEditingTradeId(null); setShowTradeForm(true); }} onEdit={(trade) => { setSelectedFundId(trade.fundId); setEditingTradeId(trade.id); setShowTradeForm(true); }} onDelete={handleDeleteTrade}/>} 
          {activePage === 'portfolio' && <PortfolioPage funds={data.funds} trades={data.trades} onSelect={(id) => { setSelectedFundId(id); setActivePage('calculator'); }}/>} 
          {activePage === 'history' && <HistoryPage data={data} filter={historyFundFilter} setFilter={setHistoryFundFilter} lastBackupAt={lastBackupAt} onDeleteSnapshot={(id) => { if (window.confirm('确定删除这条价格快照吗？')) setData((old) => ({ ...old, snapshots: old.snapshots.filter((s) => s.id !== id) })); }} onExportCsv={exportCsv} onExportJson={exportJson} onImport={() => void handleImportClick()} onDeleteFund={handleDeleteFund}/>} 
        </>}
        <footer className="app-footer"><span>仅在点击时获取公开行情，不自动轮询、不连接券商账户。</span><span>计算价格不代表买卖建议。</span></footer>
      </main></div>
    {showFundForm && <FundForm initial={editingFundId ? data.funds.find((f) => f.id === editingFundId) : undefined} onSave={handleSaveFund} onCancel={() => { setShowFundForm(false); setEditingFundId(null); }}/ >}
    {showTradeForm && selectedFund && <TradeForm key={editingTradeId ?? 'new-trade'} fund={selectedFund} initial={editingTradeId ? data.trades.find((t) => t.id === editingTradeId) : undefined} onSave={handleSaveTrade} onCancel={() => { setShowTradeForm(false); setEditingTradeId(null); }}/ >}
    {notification && <div className="toast" role="status">✓ {notification}</div>}
  </div>;
}

function macdToneClass(tone: MacdTone | undefined): string {
  switch (tone) {
    case 'bullish': return 'macd-tone-bullish';
    case 'bearish': return 'macd-tone-bearish';
    case 'mixed': return 'macd-tone-mixed';
    case 'neutral': return 'macd-tone-neutral';
    default: return 'macd-tone-unknown';
  }
}
function macdAvailabilityLabel(state: MacdPeriodState): string {
  switch (state.availability) {
    case 'ready': return '可计算';
    case 'insufficient-history': return '历史不足';
    case 'invalid-data': return '数据无效';
    case 'unavailable': return '数据不可用';
  }
}
function macdCrossEventLabel(state: MacdPeriodState): string {
  switch (state.crossEvent) {
    case 'golden': return '本根新金叉';
    case 'death': return '本根新死叉';
    case 'none': return '本根无新交叉';
    default: return '交叉状态未知';
  }
}
function bollNumber(value: number | undefined, digits = 3): string {
  return value === undefined || !Number.isFinite(value) ? '未知' : value.toFixed(digits);
}
function bollPhaseLabel(value: TechnicalStateSnapshot['boll']['bandwidthPhase']): string {
  const labels: Record<TechnicalStateSnapshot['boll']['bandwidthPhase'], string> = {
    contracting: '收窄', 'contracting-persistent': '持续收窄',
    expanding: '扩张', 'expanding-persistent': '持续扩张',
    'contracting-to-expanding': '由收窄转扩张',
    'expanding-to-contracting': '由扩张转收窄',
    flat: '走平', unknown: '未知/未配置',
  };
  return labels[value];
}
function bollMiddleLabel(value: TechnicalStateSnapshot['boll']['middleDirection']): string {
  const labels: Record<TechnicalStateSnapshot['boll']['middleDirection'], string> = {
    up: '向上', down: '向下', flat: '走平',
    'turning-up': '向上拐头', 'turning-down': '向下拐头', unknown: '未知/未配置',
  };
  return labels[value];
}
function bollLocationLabel(value: TechnicalStateSnapshot['boll']['priceLocation']): string {
  const labels: Record<TechnicalStateSnapshot['boll']['priceLocation'], string> = {
    'below-lower': '下轨下方', 'near-lower': '接近下轨',
    'below-middle': '中轨下方', 'above-middle': '中轨上方',
    'near-upper': '接近上轨', 'above-upper': '上轨上方', unknown: '未知',
  };
  return labels[value];
}
function MacdPeriodCard({ label, period, state, technical }: { label: string; period: 'daily' | 'weekly' | 'monthly'; state?: MacdPeriodState; technical?: TechnicalStateSnapshot }) {
  const [historyPage, setHistoryPage] = useState(0);
  const boll = technical?.boll;
  const bollConfig = technical?.bollConfig;
  const bollStatus = !boll ? '待计算' : boll.validity === 'VALID' ? '有效' : boll.validity === 'INSUFFICIENT' ? '历史不足' : boll.validity === 'UNAVAILABLE' ? '数据不可用' : '数据无效';
  const macdStatus = !state ? '待计算' : macdAvailabilityLabel(state);
  const coverage = technical
    ? (technical.historyStartDate ?? '—') + ' 至 ' + (technical.asOfDate ?? state?.asOfDate ?? '—') + ' · ' + technical.confirmedBarCount + ' 根确认 K 线'
    : '确认历史元数据未提供';
  const source = technical?.source ?? '未提供';
  const quoteSource = technical?.quoteSource ?? '未提供';
  const confirmation = !technical ? '确认状态元数据未提供' : technical.confirmedBarCount === 0 ? '无可确认历史 K 线' : technical.excludedInProgressBar ? '已排除进行中的 K 线' : '仅使用已确认收盘数据';
  const bollHistory = technical?.bollHistory ?? [];
  const macdHistory = technical?.macdHistory ?? [];
  const historyCount = Math.max(bollHistory.length, macdHistory.length);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(historyCount / pageSize));
  const safePage = Math.min(historyPage, pageCount - 1);
  const historyStart = Math.max(0, historyCount - (safePage + 1) * pageSize);
  const historyEnd = historyCount - safePage * pageSize;
  const historyRows = Array.from({ length: Math.max(0, historyEnd - historyStart) }, (_, offset) => {
    const index = historyStart + offset;
    return { boll: bollHistory[index], macd: macdHistory[index], date: bollHistory[index]?.date ?? macdHistory[index]?.date ?? '—' };
  });
  const latestMacdHistory = macdHistory.at(-1);
  const lastCrossText = latestMacdHistory?.formulaReady
    ? latestMacdHistory.lastCrossDate
      ? (latestMacdHistory.lastCross === 'golden' ? '金叉' : '死叉') + ' · ' + latestMacdHistory.lastCrossDate
      : '当前加载历史范围内未发现交叉'
    : '历史不足，无法确定';
  const arrangementStartDate = state?.arrangementStartDate ?? (latestMacdHistory?.formulaReady ? latestMacdHistory.arrangementStartDate : undefined);
  return <article className="macd-period-card expanded" data-period={period}>
    <div className="macd-period-head">
      <strong>{label} · 指标计算依据</strong>
      <small>最后确认日期：{technical?.asOfDate ?? state?.asOfDate ?? '—'}</small>
    </div>
    <div className="macd-period-glance"><span>BOLL {bollStatus}</span><span>MACD {macdStatus}</span></div>
    <div className="macd-period-content">
      {!technical && !state ? <p className="macd-period-message">刷新行情后获取该周期已确认历史数据。</p> : <>
        <div className="macd-period-meta">
          <small>公式版本：{technical?.formulaVersion ?? '未提供'}</small>
          <small>历史覆盖：{coverage}</small>
          <small>K 线来源：{source} · 现价来源：{quoteSource}</small>
          <small>{confirmation}</small>
        </div>
        <section className="boll-period-state">
          <div className="boll-period-state-head">
            <strong>BOLL(20,2)</strong>
            <span>{bollStatus} · 参数版本 {technical?.bollConfigVersion ?? '未提供'}</span>
          </div>
          {boll?.validity === 'VALID' ? <>
            <div className="boll-period-values">上/中/下轨：{bollNumber(boll.upper)}/{bollNumber(boll.middle)}/{bollNumber(boll.lower)}</div>
            <div className="boll-period-tags">
              <span>带宽 {bollNumber(boll.bandwidthPercent, 4)}%</span>
              <span>历史分位 {boll.bandwidthPercentile === undefined ? '未知' : bollNumber(boll.bandwidthPercentile, 1) + '%'}</span>
              <span>分位样本 {boll.bandwidthSampleCount ?? 0}/{bollConfig?.bandwidthRankLookback ?? '—'}</span>
              <span>带宽阶段 {bollPhaseLabel(boll.bandwidthPhase)}</span>
              <span>中轨方向 {bollMiddleLabel(boll.middleDirection)}</span>
              <span>确认收盘位置 {boll.closeLocationPercent === undefined ? '未知' : bollNumber(boll.closeLocationPercent, 2) + '%'} · {bollLocationLabel(boll.priceLocation)}</span>
            </div>
            <small className="boll-period-note">带宽阶段确认日期：{boll.bandwidthPhaseStartDate ?? '未知'} · 观察窗口起点：{boll.bandwidthPhaseObservationStartDate ?? '未知'}</small>
            <small className="boll-period-note">中轨方向确认日期：{boll.middleDirectionStartDate ?? '未知'} · 观察窗口起点：{boll.middleDirectionObservationStartDate ?? '未知'}</small>
            {bollConfig && <small className="boll-period-note">分类配置：中轨回看 {bollConfig.middleDirectionLookback} 根；连续确认 {bollConfig.confirmationBars} 根；走平容差 {bollConfig.flatTolerancePercent}%；近轨距离为通道宽度的 {bollConfig.nearBandDistancePercent}%。</small>}
          </> : <p className="macd-period-message">{boll?.reason ?? '当前周期尚无可用 BOLL 计算结果。'}</p>}
        </section>
        <section className="macd-indicator-state">
          <div className="boll-period-state-head"><strong>MACD(12,26,9)</strong><span>{macdStatus}</span></div>
          <div className="macd-period-meta">
            <small>EMA 初始化：快线/慢线以首根确认收盘价为种子，信号线以首根 DIF 为种子，之后按 EMA 递推。</small>
            <small>EMA 种子日期：{technical?.historyStartDate ?? '未提供'} · 实际输入 {technical?.confirmedBarCount ?? 0} 根 · 超出公式最低 35 根的额外历史：{Math.max(0, (technical?.confirmedBarCount ?? 0) - 35)} 根</small>
          </div>
          {state?.availability === 'ready' && !state.error ? <>
            <div className="macd-period-values">
              <span>DIF <strong>{bollNumber(state.dif, 6)}</strong></span>
              <span>DEA <strong>{bollNumber(state.dea, 6)}</strong></span>
              <span>柱体 <strong>{bollNumber(state.histogram, 6)}</strong></span>
            </div>
            <div className="macd-period-tags">
              <span className={macdToneClass(state.zeroTone)}>{macdZeroAxisLabel(state)}</span>
              <span className={macdToneClass(state.arrangementTone)}>{macdArrangementLabel(state)}</span>
            </div>
            <div className={'macd-momentum ' + macdToneClass(state.momentumTone)}>{macdMomentumLabel(state)}</div>
            <small className="macd-period-event">本根交叉：{macdCrossEventLabel(state)}</small>
          </> : <p className="macd-period-message">{state?.error ?? '当前周期 MACD 稳定状态尚未发布；下方仍展示实际可计算的历史公式值。'}</p>}
          <div className="macd-period-meta">
            <small>最近一次交叉：{lastCrossText}</small>
            <small>当前排列开始：{arrangementStartDate ?? '未知'}</small>
          </div>
        </section>
        <section className="technical-history-section">
          <div className="technical-history-heading">
            <strong>历史计算明细</strong>
            <span>{historyCount} 根已确认 K 线 · 默认最近 20 根</span>
          </div>
          {historyCount === 0 ? <p className="macd-period-message">当前没有可展示的逐根历史计算结果。</p> : <>
            <div className="technical-history-subheading">BOLL 历史值</div>
            <div className="table-scroll technical-history-scroll">
              <table>
                <thead><tr><th>日期</th><th>收盘</th><th>上轨</th><th>中轨</th><th>下轨</th><th>带宽</th><th>分位</th><th>阶段</th><th>中轨方向</th><th>通道位置 %</th><th>位置分类</th></tr></thead>
                <tbody>{historyRows.map((row) => <tr key={'boll-' + row.date}>
                  <td>{row.date}</td><td>{bollNumber(row.boll?.close)}</td><td>{bollNumber(row.boll?.upper)}</td><td>{bollNumber(row.boll?.middle)}</td><td>{bollNumber(row.boll?.lower)}</td>
                  <td>{row.boll?.bandwidthPercent === undefined ? '—' : bollNumber(row.boll.bandwidthPercent, 4) + '%'}</td>
                  <td>{row.boll?.bandwidthPercentile === undefined ? '—' : bollNumber(row.boll.bandwidthPercentile, 1) + '%'}</td>
                  <td>{row.boll ? bollPhaseLabel(row.boll.bandwidthPhase) : '—'}</td><td>{row.boll ? bollMiddleLabel(row.boll.middleDirection) : '—'}</td>
                  <td>{row.boll?.closeLocationPercent === undefined ? '—' : bollNumber(row.boll.closeLocationPercent, 2) + '%'}</td>
                  <td>{row.boll ? bollLocationLabel(row.boll.priceLocation) : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="technical-history-subheading">MACD 历史值</div>
            <div className="table-scroll technical-history-scroll">
              <table>
                <thead><tr><th>日期</th><th>收盘</th><th>DIF</th><th>DEA</th><th>柱体</th><th>零轴</th><th>排列</th><th>动能</th><th>当根交叉</th></tr></thead>
                <tbody>{historyRows.map((row) => {
                  const point = row.macd;
                  const zero = !point?.formulaReady ? '预热' : point.zeroAxis === 'above' ? '上方' : point.zeroAxis === 'below' ? '下方' : point.zeroAxis === 'at-zero' ? '零轴' : '未知';
                  const arrangement = !point?.formulaReady ? '预热' : point.arrangement === 'new-golden' ? '新金叉' : point.arrangement === 'new-death' ? '新死叉' : point.arrangement === 'bull-after-golden' ? '金叉后多头排列' : point.arrangement === 'bear-after-death' ? '死叉后空头排列' : point.arrangement === 'bull-history-unknown' ? '多头排列·交叉历史不足' : point.arrangement === 'bear-history-unknown' ? '空头排列·交叉历史不足' : point.arrangement === 'neutral' ? 'DIF/DEA 重合' : '未知';
                  const momentum = !point?.formulaReady ? '预热' : point.momentum === 'bull-strengthening' ? '多头动能增强' : point.momentum === 'bull-weakening' ? '多头动能减弱' : point.momentum === 'bear-strengthening' ? '空头动能增强' : point.momentum === 'bear-weakening' ? '空头动能减弱' : point.momentum === 'neutral' ? '动能变化不明显' : '未知';
                  const cross = !point?.formulaReady ? '预热' : point.crossEvent === 'golden' ? '金叉' : point.crossEvent === 'death' ? '死叉' : point.crossEvent === 'none' ? '无新交叉' : '未知';
                  return <tr key={'macd-' + row.date}>
                    <td>{row.date}</td><td>{bollNumber(point?.close)}</td><td>{point?.formulaReady ? bollNumber(point.dif, 6) : '预热'}</td><td>{point?.formulaReady ? bollNumber(point.dea, 6) : '预热'}</td><td>{point?.formulaReady ? bollNumber(point.histogram, 6) : '预热'}</td>
                    <td>{zero}</td><td>{arrangement}</td><td>{momentum}</td><td>{cross}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="technical-history-pagination">
              <button type="button" className="text-button" disabled={safePage >= pageCount - 1} onClick={() => setHistoryPage((page) => Math.min(pageCount - 1, page + 1))}>更早 20 根</button>
              <span>第 {safePage + 1} / {pageCount} 页 · 显示 {historyRows.length} 根</span>
              <button type="button" className="text-button" disabled={safePage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}>更新 20 根</button>
            </div>
          </>}
        </section>
      </>}
    </div>
  </article>;
}
function MacdPanel({ state, technical, loading, error, stale }: { state?: MacdMultiTimeframeState; technical?: TechnicalMultiTimeframeState; loading: boolean; error?: string; stale: boolean }) {
  const [activePeriod, setActivePeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const technicalDescription = technical ? describeTechnicalMultiTimeframeState(technical) : undefined;
  const summary = technicalDescription
    ? stale ? '本次行情刷新失败，以下仍为上次成功数据。原因：' + (error ?? '未知错误') + ' · ' + technicalDescription.summary : technicalDescription.summary
    : error ? '行情数据不可用：' + error : loading ? '正在刷新 BOLL + MACD 数据…' : '刷新行情后计算';
  const activeLabel = activePeriod === 'daily' ? '日线' : activePeriod === 'weekly' ? '周线' : '月线';
  const activeState = state?.[activePeriod];
  const activeTechnical = technical?.[activePeriod];
  return <div className="macd-panel">
    <div className="macd-panel-head"><div><h3>BOLL + MACD 技术状态</h3><p>按日、周、月分别描述；只使用已确认 K 线，不生成交易方向</p></div><span className="macd-rule-label">描述性数据</span></div>
    <div className="macd-summary"><strong className="macd-tone-neutral">{summary}</strong></div>
    <div className="macd-period-selector" role="tablist" aria-label="选择技术状态周期">
      <button type="button" role="tab" aria-selected={activePeriod === 'daily'} className={activePeriod === 'daily' ? 'macd-period-tab active' : 'macd-period-tab'} onClick={() => setActivePeriod('daily')}>日线</button>
      <button type="button" role="tab" aria-selected={activePeriod === 'weekly'} className={activePeriod === 'weekly' ? 'macd-period-tab active' : 'macd-period-tab'} onClick={() => setActivePeriod('weekly')}>周线</button>
      <button type="button" role="tab" aria-selected={activePeriod === 'monthly'} className={activePeriod === 'monthly' ? 'macd-period-tab active' : 'macd-period-tab'} onClick={() => setActivePeriod('monthly')}>月线</button>
    </div>
    <MacdPeriodCard key={activePeriod} label={activeLabel} period={activePeriod} state={activeState} technical={activeTechnical}/>
    <small className="macd-footnote">仅描述已确认行情中的指标计算结果，不构成买卖建议。MACD 状态发布门槛：日线 {MACD_STABILITY_MIN_BARS.daily} 根、周线 {MACD_STABILITY_MIN_BARS.weekly} 根、月线 {MACD_STABILITY_MIN_BARS.monthly} 根确认 K 线；该门槛不代表交易有效性验证。</small>
  </div>;
}

function CalculatorPage({ fund, comparisons, ladderBasis, setLadderBasis, ladderDirection, setLadderDirection, ladderRows, onPriceChange, quoteState, onRefreshQuote, onUseLatestTrade, onSaveSnapshot, snapshotNote, setSnapshotNote, onGoLedger }: {
  fund: Fund; comparisons: ReturnType<typeof compareToBases>; ladderBasis: PriceKey; setLadderBasis: (key: PriceKey) => void; ladderDirection: Direction; setLadderDirection: (dir: Direction) => void; ladderRows: ReturnType<typeof priceLadder>; onPriceChange: (key: keyof FundPrices, value: string) => void; quoteState?: QuoteViewState; onRefreshQuote: () => void; onUseLatestTrade: () => void; onSaveSnapshot: () => void; snapshotNote: string; setSnapshotNote: (value: string) => void; onGoLedger: () => void;
}) {
  const baseLabels: Record<PriceKey, string> = { upper: 'BOLL 上轨', middle: 'BOLL 中轨', lower: 'BOLL 下轨', previousClose: '昨日收盘价', lastTradePrice: '上一次成交价' };
  const selectedComparison = comparisons.find((x) => x.key === ladderBasis);
  const bollRangePosition = bollRangePositionRatio(fund.prices);
  const weeklyBollRange = quoteState?.quote?.weeklyBollRange;
  const monthlyBollRange = quoteState?.quote?.monthlyBollRange;
  const weeklyBollRangePosition = weeklyBollRange ? bollRangePositionRatioForBands(fund.prices.currentPrice, weeklyBollRange.lower, weeklyBollRange.upper) : null;
  const monthlyBollRangePosition = monthlyBollRange ? bollRangePositionRatioForBands(fund.prices.currentPrice, monthlyBollRange.lower, monthlyBollRange.upper) : null;
  // Daily position colors its number only at 0%/100% boundaries; 50% has no special color.
  const dailyPositionTone = bollRangePosition !== null && bollRangePosition >= 1 ? 'daily-position-red' : bollRangePosition !== null && bollRangePosition <= 0 ? 'daily-position-green' : '';
  // Weekly/monthly positions color the whole card at 50%; their rail prices aren't displayed.
  const weeklyPositionClass = weeklyBollRangePosition === null ? '' : weeklyBollRangePosition >= 0.5 ? 'position-heat-red' : 'position-heat-green';
  const monthlyPositionClass = monthlyBollRangePosition === null ? '' : monthlyBollRangePosition >= 0.5 ? 'position-heat-red' : 'position-heat-green';
  const current = fund.prices.currentPrice.trim() ? parseMaybe(fund.prices.currentPrice) : null;
  const baseValue = selectedComparison?.base.trim() ? parseMaybe(selectedComparison.base) : null;
  const currentPct = selectedComparison?.percent ?? null;
  const nextRow = ladderRows.find((row) => row.isNext);
  const hasCurrent = current !== null;
  // Compare against the 10th rung's exact scaled price, not a rounded percent — the two
  // disagree by up to half a basis point and the rung is the truth.
  const tenthRung = ladderRows.at(-1) ?? null;
  const overRange = hasCurrent && baseValue !== null && tenthRung !== null && parseScaled(fund.prices.currentPrice) > 0n && (ladderDirection === 'up' ? parseScaled(fund.prices.currentPrice) >= tenthRung.priceScaled : parseScaled(fund.prices.currentPrice) <= tenthRung.priceScaled);
  const [comparisonExpanded, setComparisonExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem('fund-boll-ledger:comparison-expanded') !== 'false'; }
    catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('fund-boll-ledger:comparison-expanded', String(comparisonExpanded)); }
    catch { /* Local storage may be unavailable; collapse still works for this session. */ }
  }, [comparisonExpanded]);
  return <div className="page-stack">
    <section className="panel price-reference-panel"><div className="section-title-row"><div><h2>价格基准</h2><p>修改输入后即时重新计算；历史快照需手动保存。</p></div><span className="tag">{fund.category} · {fund.tickSize || '0.001'} 元/档</span></div><div className="reference-grid"><PriceInput label="BOLL 上轨" value={fund.prices.upper} onChange={(v) => onPriceChange('upper', v)} placeholder="输入上轨"/><PriceInput label="BOLL 中轨" value={fund.prices.middle} onChange={(v) => onPriceChange('middle', v)} placeholder="输入中轨"/><PriceInput label="BOLL 下轨" value={fund.prices.lower} onChange={(v) => onPriceChange('lower', v)} placeholder="输入下轨"/><PriceInput label="昨日收盘价" value={fund.prices.previousClose} onChange={(v) => onPriceChange('previousClose', v)} placeholder="输入昨日收盘价"/><div className="reference-input last-trade-input"><PriceInput label="上一次成交价" value={fund.prices.lastTradePrice} onChange={(v) => onPriceChange('lastTradePrice', v)} placeholder="输入上一笔成交价"/><button className="text-button reference-fill" onClick={onUseLatestTrade}>取最近成交价 ↗</button></div><div className="current-price-input">
      <PriceInput label="当前价格" value={fund.prices.currentPrice} onChange={(v) => onPriceChange('currentPrice', v)} placeholder="输入你看到的最新价格" prominent/>
      <div className="quote-refresh-row">
        <button type="button" className={'button outline quote-refresh-button ' + (quoteState?.status === 'success' ? 'is-success' : quoteState?.status === 'error' ? 'is-error' : '')} onClick={onRefreshQuote} disabled={quoteState?.status === 'loading' || !fund.code.trim()} aria-label="刷新行情" aria-live="polite">{quoteState?.status === 'loading' ? '正在刷新…' : quoteState?.status === 'success' ? <><span className="refresh-check" aria-hidden="true">✓</span> 刷新完成</> : quoteState?.status === 'error' ? '重试刷新' : '↻ 刷新行情'}</button>
        <div className="quote-refresh-meta" aria-live="polite">
          {quoteState?.hasManualEdits && quoteState?.quote && quoteState.quote.code === fund.code && <>
            <strong className={getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose) > 0 ? 'positive' : getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose) < 0 ? 'negative' : ''}>日涨跌 {formatQuotePercent(getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose))}</strong>
            <small>来源：{quoteState.quote.source} · 行情时间：{quoteState.quote.quotedAt || '源端未提供'} · 获取于 {quoteState.quote.fetchedAt}</small>
            {quoteState.quote.boll && <small>BOLL(20,2) · 日线日期：{quoteState.quote.boll.tradingDate}{quoteState.quote.boll.currentPriceApplied ? ' · 已按本次现价重算' : ' · 使用行情源日线收盘价'}</small>}
            {quoteState.quote.bollError && <small className="quote-error" role="status">BOLL未更新：{quoteState.quote.bollError}；原有轨道价格已保留。</small>}{quoteState.quote.weeklyBollRangeError && <small className="quote-error" role="status">周 BOLL 未更新：{quoteState.quote.weeklyBollRangeError}</small>}{quoteState.quote.monthlyBollRangeError && <small className="quote-error" role="status">月 BOLL 未更新：{quoteState.quote.monthlyBollRangeError}</small>}
            <small>价格字段已手动修改；涨跌幅按当前输入的现价与昨收重新计算。</small>
          </>}
          {quoteState?.quote && !quoteState.hasManualEdits && quoteState.quote.code === fund.code && <>
            <strong className={getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose) > 0 ? 'positive' : getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose) < 0 ? 'negative' : ''}>日涨跌 {formatQuotePercent(getInputChangePercent(fund.prices.currentPrice, fund.prices.previousClose))}</strong>
            <small>来源：{quoteState.quote.source} · 行情时间：{quoteState.quote.quotedAt || '源端未提供'} · 获取于 {quoteState.quote.fetchedAt}</small>
            {quoteState.quote.boll && <small>BOLL(20,2) · 日线日期：{quoteState.quote.boll.tradingDate}{quoteState.quote.boll.currentPriceApplied ? ' · 已按本次现价重算' : ' · 使用行情源日线收盘价'}</small>}
            {quoteState.quote.bollError && <small className="quote-error" role="status">BOLL未更新：{quoteState.quote.bollError}；原有轨道价格已保留。</small>}{quoteState.quote.weeklyBollRangeError && <small className="quote-error" role="status">周 BOLL 未更新：{quoteState.quote.weeklyBollRangeError}</small>}{quoteState.quote.monthlyBollRangeError && <small className="quote-error" role="status">月 BOLL 未更新：{quoteState.quote.monthlyBollRangeError}</small>}
          </>}
          {quoteState?.status === 'loading' && quoteState.hasManualEdits && <small className="quote-error" role="status">价格字段已手动修改；本次刷新不会覆盖你手动改过的价格字段。</small>}
          {!quoteState?.quote && quoteState?.status === 'loading' && <small>正在请求东方财富；失败时自动尝试腾讯，再尝试百度。</small>}
          {!quoteState?.quote && quoteState?.status === 'error' && <small className="quote-error" role="status">{quoteState.message} 未覆盖当前价格。</small>}
          {!quoteState && <small>点击刷新获取最新价、昨收和日/周/月区间位置所需数据；只有日 BOLL 三条轨道显示为可编辑价格基准，不自动轮询。</small>}
          {quoteState?.status === 'loading' && <small>正在刷新报价和日/周/月 BOLL……</small>}
          {quoteState?.status === 'error' && quoteState.quote && <small className="quote-error" role="status">{quoteState.message} 本次未覆盖价格，保留上次成功报价。</small>}
        </div>
      </div>
    </div></div></section>
    <section className="panel comparison-panel">
      <div className="section-title-row comparison-section-head">
        <div><h2>当前价格对比</h2><p>五个价格基准分别比较；日、周、月 BOLL 区间位置按各自周期轨道独立计算。</p></div>
        <div className="comparison-head-actions"><span className="muted small">当前价：{fund.prices.currentPrice || '—'}</span>
          <button type="button" className="button ghost comparison-toggle" aria-expanded={comparisonExpanded} aria-controls="current-price-comparison-content" onClick={() => setComparisonExpanded((value) => !value)}>
            {comparisonExpanded ? '收起内容 −' : '展开内容 +'}
          </button>
        </div>
      </div>
      {comparisonExpanded && <div id="current-price-comparison-content" className="comparison-content">
        <div className="comparison-grid">{comparisons.map((item) => <div key={item.key} className={`comparison-card ${item.percent === null ? '' : item.percent > 0 ? 'is-up' : item.percent < 0 ? 'is-down' : ''}`}><span>{item.label}</span><strong>{item.percentLabel}</strong><div className="comparison-foot"><span>基准 {item.base || '—'}</span><span>{item.delta !== null ? `${Number(item.delta) > 0 ? '+' : ''}${item.delta}` : '—'} 元</span></div><small>{item.location}</small></div>)}<div className="comparison-card daily-position-card"><span>日 BOLL 区间位置</span><strong className={dailyPositionTone}>{bollRangePosition === null ? '待输入有效价格/轨道' : (bollRangePosition * 100).toFixed(2) + '%'}</strong><div className="comparison-foot"><span>下轨 0%</span><span>上轨 100%</span></div><small>{bollRangePosition === null ? '需要有效现价、下轨和高于下轨的上轨' : bollRangePosition < 0 ? '当前价低于下轨 · 绿色' : bollRangePosition === 0 ? '当前价位于下轨 · 绿色' : bollRangePosition > 1 ? '当前价高于上轨 · 红色' : bollRangePosition === 1 ? '当前价位于上轨 · 红色' : '位置在下轨至上轨之间'}</small></div><div className={`comparison-card ${weeklyPositionClass}`}><span>周 BOLL 区间位置</span><strong>{weeklyBollRangePosition === null ? (weeklyBollRange ? '待输入有效现价/轨道' : '刷新后计算') : (weeklyBollRangePosition * 100).toFixed(2) + '%'}</strong><div className="comparison-foot"><span>下轨 0%</span><span>上轨 100%</span></div><small>{weeklyBollRangePosition !== null ? (weeklyBollRangePosition >= 0.5 ? '≥50% · 红色显示' : '<50% · 绿色显示') : quoteState?.quote?.weeklyBollRangeError ? `周线数据不可用：${quoteState.quote.weeklyBollRangeError}` : '需要刷新周线数据并输入有效当前价'}</small></div><div className={`comparison-card ${monthlyPositionClass}`}><span>月 BOLL 区间位置</span><strong>{monthlyBollRangePosition === null ? (monthlyBollRange ? '待输入有效现价/轨道' : '刷新后计算') : (monthlyBollRangePosition * 100).toFixed(2) + '%'}</strong><div className="comparison-foot"><span>下轨 0%</span><span>上轨 100%</span></div><small>{monthlyBollRangePosition !== null ? (monthlyBollRangePosition >= 0.5 ? '≥50% · 红色显示' : '<50% · 绿色显示') : quoteState?.quote?.monthlyBollRangeError ? `月线数据不可用：${quoteState.quote.monthlyBollRangeError}` : '需要刷新月线数据并输入有效当前价'}</small></div></div>
        <MacdPanel state={quoteState?.quote?.macd} technical={quoteState?.quote?.technicalState} loading={quoteState?.status === 'loading'} error={quoteState?.status === 'error' ? quoteState.message : undefined} stale={quoteState?.status === 'error' && Boolean(quoteState.quote)}/>
      </div>}
    </section>
    <section className="panel ladder-panel"><div className="section-title-row"><div><h2>十档价格阶梯</h2><p>每一档均以所选参考价独立计算，不使用连续复利。</p></div><span className="tag">1%—10%</span></div><div className="ladder-controls"><label className="field basis-select"><span>选择计算基准</span><select value={ladderBasis} onChange={(e) => setLadderBasis(e.target.value as PriceKey)}>{PRICE_KEYS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label><div className="direction-switch" role="group" aria-label="阶梯方向"><button className={ladderDirection === 'up' ? 'active rise' : ''} onClick={() => setLadderDirection('up')}>↑ 上涨 1%—10%</button><button className={ladderDirection === 'down' ? 'active fall' : ''} onClick={() => setLadderDirection('down')}>↓ 下跌 1%—10%</button></div></div><div className="ladder-status">{!fund.prices.currentPrice.trim() || current === null || current <= 0 || baseValue === null ? <span>请输入有效的当前价格（大于零）和所选基准，系统才可标记已越过档位。</span> : <><div><span className="status-label">当前相对{baseLabels[ladderBasis]}</span><strong className={currentPct! > 0 ? 'positive' : currentPct! < 0 ? 'negative' : ''}>{formatPercent(currentPct)}</strong></div><div className="next-target">{overRange ? `当前价格已超出所选方向的十档范围（实际涨跌幅 ${formatPercent(currentPct)}）` : nextRow ? `下一档：${ladderDirection === 'up' ? '+' : '−'}${nextRow.percent}% · ${nextRow.price} 元` : ladderRows.length && ladderRows.every((r) => r.reached) ? `已越过全部十档（实际涨跌幅 ${formatPercent(currentPct)}）` : '尚未到达第一档'}</div></>}</div>{ladderRows.length ? <div className="table-scroll"><table className="ladder-table"><thead><tr><th>刻度</th><th>对应价格（元）</th><th>理论档位</th><th>当前状态</th></tr></thead><tbody>{ladderRows.map((row) => <tr key={row.percent} className={`${row.reached ? 'reached-row' : ''} ${row.isNext ? 'next-row' : ''}`}><td><span className={`level-chip ${ladderDirection}`}>{ladderDirection === 'up' ? '+' : '−'}{row.percent}%</span></td><td><strong>{row.price}</strong></td><td>{ladderDirection === 'up' ? '+' : '−'}{row.percent}.00%</td><td>{row.reached ? <span className="state-pill crossed">已越过</span> : row.isNext ? <span className="state-pill next">下一档</span> : <span className="state-pill pending">尚未到达</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state compact"><strong>尚未生成阶梯</strong><span>请先填写上方选择的基准价格，并检查最小价格变动单位。</span></div>}<div className="ladder-note"><span>报价单位：{fund.tickSize} 元</span><span>价格先计算，再按报价单位四舍五入。</span><span>已越过标记只用于价格定位，不构成交易信号。</span></div></section>
    <section className="snapshot-bar"><div><strong>保存今天的价格观察</strong><p>保留五个基准和当前价，便于回顾当时阶梯。每次保存都会生成一条快照。</p></div><div className="snapshot-actions"><input value={snapshotNote} onChange={(e) => setSnapshotNote(e.target.value)} placeholder="备注（可选）" aria-label="快照备注"/><button className="button primary" onClick={onSaveSnapshot}>保存价格快照</button></div></section>
    <section className="panel quick-action-panel"><div><h3>准备记一笔买入或卖出？</h3><p className="muted">成交价、份额、佣金和其他费用在交易账本中单独记录。</p></div><button className="button outline" onClick={onGoLedger}>新增交易记录 →</button></section>
  </div>;
}
function getInputChangePercent(currentPrice: string, previousClose: string): number { const current = parseMaybe(currentPrice); const close = parseMaybe(previousClose); return current !== null && close !== null && close > 0 ? (current - close) / close * 100 : 0; }
function formatQuotePercent(value: number): string { const normalized = Math.abs(value) < 0.005 ? 0 : value; return (normalized > 0 ? '+' : '') + normalized.toFixed(2) + '%'; }
function parseMaybe(value: string): number | null { const n = Number(value); return value.trim() && Number.isFinite(n) ? n : null; }
function PriceInput({ label, value, onChange, placeholder, prominent = false }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; prominent?: boolean }) {
  return <label className={`price-input ${prominent ? 'prominent' : ''}`}><span>{label}</span><input type="number" inputMode="decimal" step="any" min="0" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>;
}

function LedgerPage({ fund, funds, trades, position, onAdd, onEdit, onDelete }: { fund: Fund; funds: Fund[]; trades: Trade[]; position: ReturnType<typeof calculatePosition>; onAdd: () => void; onEdit: (trade: Trade) => void; onDelete: (trade: Trade) => void }) {
  const [fundFilter, setFundFilter] = useState('all');
  const [sideFilter, setSideFilter] = useState<'all' | TradeSide>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [keyword, setKeyword] = useState('');
  const fundById = useMemo(() => new Map(funds.map((item) => [item.id, item])), [funds]);
  const filteredTrades = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return trades.filter((trade) => {
      const tradeDate = dateOf(trade.tradedAt);
      const relatedFund = fundById.get(trade.fundId);
      if (fundFilter !== 'all' && trade.fundId !== fundFilter) return false;
      if (sideFilter !== 'all' && trade.side !== sideFilter) return false;
      if (fromDate && tradeDate < fromDate) return false;
      if (toDate && tradeDate > toDate) return false;
      if (query && ![relatedFund?.name ?? '', relatedFund?.code ?? '', trade.note, trade.price, trade.quantity].some((value) => value.toLocaleLowerCase().includes(query))) return false;
      return true;
    });
  }, [trades, fundById, fundFilter, sideFilter, fromDate, toDate, keyword]);
  const unrealized = unrealizedPnlCents(fund.prices.currentPrice, position);
  const clearFilters = () => { setFundFilter('all'); setSideFilter('all'); setFromDate(''); setToDate(''); setKeyword(''); };
  return <div className="page-stack"><section className="summary-grid four"><Metric label="当前持仓" value={`${position.quantity.toString()} 份`} hint={fund.name}/><Metric label="剩余持仓成本" value={formatCurrency(position.costBasisCents)} hint="当前选中基金，含已记录买入费用"/><Metric label="已实现盈亏" value={formatCurrency(position.realizedCents)} tone={position.realizedCents > 0n ? 'up' : position.realizedCents < 0n ? 'down' : 'neutral'} hint="当前选中基金，扣除实际费用"/><Metric label="浮动盈亏" value={unrealized === null ? '需输入当前价' : formatCurrency(unrealized)} tone={unrealized !== null && unrealized > 0n ? 'up' : unrealized !== null && unrealized < 0n ? 'down' : 'neutral'} hint={unrealized === null ? '请先输入当前价' : '当前选中基金，未扣未来卖出费用'}/></section>
    {position.error && <div className="storage-warning"><strong>账本校验异常：</strong>{position.error}</div>}
    <section className="panel"><div className="section-title-row"><div><h2>交易明细</h2><p>支持跨基金查询；编辑和删除始终按每笔交易自身的基金归属处理。所有记录均由手动输入，实际成交费用优先于费率估算。</p></div><button className="button primary" onClick={onAdd}>＋ 新增交易</button></div>
      <div className="form-grid filters-grid">
        <label className="field"><span>筛选基金</span><select aria-label="筛选基金" value={fundFilter} onChange={(event) => setFundFilter(event.target.value)}><option value="all">全部基金</option>{funds.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ''}</option>)}</select></label>
        <label className="field"><span>买卖方向</span><select aria-label="买卖方向" value={sideFilter} onChange={(event) => setSideFilter(event.target.value as 'all' | TradeSide)}><option value="all">全部方向</option><option value="BUY">买入</option><option value="SELL">卖出</option></select></label>
        <Field label="开始日期" value={fromDate} onChange={setFromDate} type="date"/>
        <Field label="结束日期" value={toDate} onChange={setToDate} type="date"/>
        <Field label="关键词" value={keyword} onChange={setKeyword} placeholder="基金名称、代码、备注、价格或数量"/>
        <div className="field filter-actions"><span>筛选结果</span><div><strong>{filteredTrades.length} / {trades.length} 笔</strong><button type="button" className="text-button" onClick={clearFilters}>清空筛选</button></div></div>
      </div>
      {filteredTrades.length === 0 ? <div className="empty-state"><div className="empty-icon">≡</div><strong>{trades.length === 0 ? '还没有交易记录' : '没有符合条件的交易'}</strong><span>{trades.length === 0 ? '录入第一笔买入或卖出后，系统会开始计算持仓和盈亏。' : '调整基金、日期、方向或关键词后重试。'}</span>{trades.length === 0 && <button className="button outline" onClick={onAdd}>新增第一笔交易</button>}</div> : <div className="table-scroll"><table><thead><tr><th>基金</th><th>成交时间</th><th>方向</th><th>成交价</th><th>数量</th><th>成交金额</th><th>费用合计</th><th>费用核对</th><th>现金流</th><th>备注</th><th>操作</th></tr></thead><tbody>{filteredTrades.map((trade) => {
        const gross = priceAmountCents(trade.price, trade.quantity);
        const fee = parseMoneyCents(trade.commission) + parseMoneyCents(trade.transferFee) + parseMoneyCents(trade.stampDuty) + parseMoneyCents(trade.otherFee);
        const relatedFund = fundById.get(trade.fundId);
        return <tr key={trade.id}><td>{relatedFund?.name ?? '（基金已删除）'}</td><td>{trade.tradedAt.replace('T', ' ')}</td><td><span className={`trade-badge ${trade.side.toLowerCase()}`}>{trade.side === 'BUY' ? '买入' : '卖出'}</span></td><td>{trade.price}</td><td>{trade.quantity}</td><td>{formatCurrency(gross)}</td><td>{formatCurrency(fee)}</td><td><span className={`state-pill ${trade.feesChecked ? 'crossed' : 'pending'}`}>{trade.feesChecked ? '已核对' : '待核对'}</span></td><td className={trade.side === 'BUY' ? 'negative' : 'positive'}>{trade.side === 'BUY' ? '−' : '+'}{formatCurrency(trade.side === 'BUY' ? gross + fee : gross - fee).replace('¥', '')}</td><td className="note-cell">{trade.note || '—'}</td><td><div className="row-actions"><button className="text-button" onClick={() => onEdit(trade)}>编辑</button><button className="text-button danger-text" onClick={() => onDelete(trade)}>删除</button></div></td></tr>;
      })}</tbody></table></div>}
      <div className="ledger-footnote"><span>持仓与盈亏摘要对应页头当前选中基金；交易列表及费用拆分按筛选结果展示。</span><span>持仓成本采用加权平均法；卖出数量超过当时持仓会被拒绝。</span></div></section>
    <section className="panel fees-breakdown"><div><h2>筛选结果费用拆分</h2><p className="muted small">仅汇总当前筛选结果；若有实际交割单，请逐笔核对避免重复记账。</p></div><div className="summary-grid four compact-summary"><Metric label="累计佣金" value={formatCurrency(filteredTrades.reduce((sum, trade) => sum + parseMoneyCents(trade.commission), 0n))}/><Metric label="经手/过户等" value={formatCurrency(filteredTrades.reduce((sum, trade) => sum + parseMoneyCents(trade.transferFee), 0n))}/><Metric label="印花税" value={formatCurrency(filteredTrades.reduce((sum, trade) => sum + parseMoneyCents(trade.stampDuty), 0n))}/><Metric label="其他费用" value={formatCurrency(filteredTrades.reduce((sum, trade) => sum + parseMoneyCents(trade.otherFee), 0n))}/></div></section>
  </div>;
}

function PortfolioPage({ funds, trades, onSelect }: { funds: Fund[]; trades: Trade[]; onSelect: (id: string) => void }) {
  const positions = funds.map((fund) => ({ fund, position: calculatePosition(trades, fund.id) }));
  const totals = positions.reduce((sum, item) => { const floating = unrealizedPnlCents(item.fund.prices.currentPrice, item.position); return { cost: sum.cost + item.position.costBasisCents, realized: sum.realized + item.position.realizedCents, market: sum.market + (currentValueCents(item.fund.prices.currentPrice, item.position.quantity) ?? 0n), unrealized: sum.unrealized + (floating ?? 0n) }; }, { cost: 0n, realized: 0n, market: 0n, unrealized: 0n });
  return <div className="page-stack"><section className="summary-grid four"><Metric label="剩余持仓成本" value={formatCurrency(totals.cost)}/><Metric label="当前参考市值" value={formatCurrency(totals.market)} hint="仅统计已输入当前价的基金"/><Metric label="已实现盈亏" value={formatCurrency(totals.realized)} tone={totals.realized > 0n ? 'up' : totals.realized < 0n ? 'down' : 'neutral'}/><Metric label="已输入价基金的浮动盈亏" value={formatCurrency(totals.unrealized)} tone={totals.unrealized > 0n ? 'up' : totals.unrealized < 0n ? 'down' : 'neutral'} hint="未输入当前价的基金不计入"/></section>
    <section className="panel"><div className="section-title-row"><div><h2>基金持仓汇总</h2><p>选中基金可进入价格计算；当前参考价为空时，该基金浮动盈亏不应视为有效结果。</p></div><span className="tag">共 {funds.length} 只基金</span></div><div className="table-scroll"><table><thead><tr><th>基金</th><th>代码</th><th>持仓份额</th><th>剩余成本</th><th>当前参考价</th><th>参考市值</th><th>已实现盈亏</th><th>浮动盈亏</th><th>操作</th></tr></thead><tbody>{positions.map(({ fund, position }) => { const unrealized = unrealizedPnlCents(fund.prices.currentPrice, position); const marketValue = currentValueCents(fund.prices.currentPrice, position.quantity); return <tr key={fund.id}><td><strong>{fund.name}</strong><small className="table-sub">{fund.category}</small></td><td>{fund.code || '—'}</td><td>{position.quantity.toString()}</td><td>{formatCurrency(position.costBasisCents)}</td><td>{fund.prices.currentPrice || '—'}</td><td>{marketValue === null ? '—' : formatCurrency(marketValue)}</td><td className={position.realizedCents > 0n ? 'positive' : position.realizedCents < 0n ? 'negative' : ''}>{formatCurrency(position.realizedCents)}</td><td className={unrealized !== null && unrealized > 0n ? 'positive' : unrealized !== null && unrealized < 0n ? 'negative' : ''}>{unrealized === null ? '—' : formatCurrency(unrealized)}</td><td><button className="text-button" onClick={() => onSelect(fund.id)}>打开</button></td></tr>; })}</tbody></table></div><div className="ledger-footnote"><span>持仓成本与已实现盈亏由交易明细推算；数据完整性取决于交易记录是否齐全。</span><span>浮动盈亏使用你手动输入的当前价格。</span></div></section></div>;
}

function snapshotPriceChange(current: string, previous: string, tickSize: string): string {
  if (!current.trim() || !previous.trim()) return '缺少价格，无法比较';
  try {
    const currentValue = parseScaled(current);
    const previousValue = parseScaled(previous);
    const difference = currentValue - previousValue;
    const decimals = Math.max(0, Math.min(6, (tickSize.split('.')[1] || '').length));
    const delta = `${difference > 0n ? '+' : ''}${formatScaled(difference, decimals)} 元`;
    return `${delta} · ${formatPercent(percentHundredths(currentValue, previousValue))}`;
  } catch {
    return '价格格式异常，无法比较';
  }
}

function HistoryPage({ data, filter, setFilter, lastBackupAt, onDeleteSnapshot, onExportCsv, onExportJson, onImport, onDeleteFund }: { data: AppData; filter: string; setFilter: (value: string) => void; lastBackupAt: string | null; onDeleteSnapshot: (id: string) => void; onExportCsv: () => void; onExportJson: () => void; onImport: () => void; onDeleteFund: () => void }) {
  const previousSnapshots = useMemo(() => {
    const grouped = new Map<string, PriceSnapshot[]>();
    for (const snapshot of data.snapshots) {
      const group = grouped.get(snapshot.fundId) ?? [];
      group.push(snapshot);
      grouped.set(snapshot.fundId, group);
    }
    const previous = new Map<string, PriceSnapshot>();
    for (const group of grouped.values()) {
      group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (let index = 1; index < group.length; index += 1) previous.set(group[index].id, group[index - 1]);
    }
    return previous;
  }, [data.snapshots]);
  const filteredSnapshots = data.snapshots.filter((s) => filter === 'all' ? true : s.fundId === filter).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const fundName = (id: string) => data.funds.find((f) => f.id === id)?.name ?? '（基金已删除）';
  return <div className="page-stack"><section className="panel"><div className="section-title-row"><div><h2>价格历史快照</h2><p>快照由你主动保存，保留当时录入的基准价、当前价、报价单位和备注。</p></div><label className="field filter-field"><span>筛选基金</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部基金</option>{data.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label></div>{filteredSnapshots.length === 0 ? <div className="empty-state"><div className="empty-icon">↻</div><strong>还没有价格快照</strong><span>在“价格计算”页填写价格后点击“保存价格快照”。</span></div> : <div className="snapshot-list">{filteredSnapshots.map((snapshot) => <article className="snapshot-card" key={snapshot.id}><div className="snapshot-title"><div><strong>{fundName(snapshot.fundId)}</strong><span className="muted">{snapshot.tradingDate} · {new Date(snapshot.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><button className="text-button danger-text" onClick={() => onDeleteSnapshot(snapshot.id)}>删除</button></div><div className="snapshot-values"><span>上轨<strong>{snapshot.prices.upper || '—'}</strong></span><span>中轨<strong>{snapshot.prices.middle || '—'}</strong></span><span>下轨<strong>{snapshot.prices.lower || '—'}</strong></span><span>昨收<strong>{snapshot.prices.previousClose || '—'}</strong></span><span>上次成交<strong>{snapshot.prices.lastTradePrice || '—'}</strong></span><span>当前价<strong>{snapshot.prices.currentPrice || '—'}</strong></span></div><div className="snapshot-change"><div className="snapshot-change-head"><strong>较上一条同基金快照变化</strong><span>{previousSnapshots.get(snapshot.id) ? `对比 ${previousSnapshots.get(snapshot.id)!.tradingDate}` : '暂无上一条同基金快照'}</span></div>{previousSnapshots.has(snapshot.id) ? <div className="snapshot-change-grid">{PRICE_KEYS.map(({ key, label }) => <div key={key}><span>{label}</span><strong>{snapshotPriceChange(snapshot.prices[key], previousSnapshots.get(snapshot.id)!.prices[key], snapshot.tickSize)}</strong></div>)}</div> : <p className="snapshot-change-empty">该基金首次保存的快照作为比较起点，后续快照将显示五个价格基准的变化。</p>}</div>{snapshot.note && <p className="snapshot-note">备注：{snapshot.note}</p>}</article>)}</div>}</section>
    <section className="panel backup-panel"><div className="section-title-row"><div><h2>数据备份与迁移</h2><p>建议至少每 7 天发起一次完整 JSON 导出。上次发起导出：{lastBackupAt ? new Date(lastBackupAt).toLocaleString() : '尚未导出'}。CSV 仅用于查看交易明细，不包含完整档案和价格快照。</p></div><span className="tag">本地数据</span></div><div className="backup-grid"><div className="backup-card"><div className="backup-icon">↓</div><div><strong>完整 JSON 备份</strong><p>包括基金档案、费用规则、全部交易明细和价格快照。可用于恢复。</p></div><button className="button primary" onClick={onExportJson}>导出 JSON</button></div><div className="backup-card"><div className="backup-icon">≡</div><div><strong>交易明细 CSV</strong><p>可用 Excel 打开检查成交价格、数量、费用和备注。</p></div><button className="button outline" onClick={onExportCsv}>导出 CSV</button></div><div className="backup-card"><div className="backup-icon">↑</div><div><strong>从备份恢复</strong><p>导入会替换当前设备全部数据。请先导出当前备份。</p></div><button className="button outline" onClick={onImport}>选择 JSON 文件</button></div></div><div className="important-note"><strong>跨设备提示</strong><p>当前版本采用 IndexedDB 本地存储。Windows 和安卓各自存储一份数据，不会自动同步。需要跨设备共享时，请导出 JSON，并在另一设备导入。云端同步不属于当前首版，避免未经授权把交易账本上传到服务器。</p></div></section>
    <section className="panel destructive-panel"><div><h2>基金数据管理</h2><p className="muted">此操作会删除当前选中基金、对应交易和全部价格快照。请先下载完整备份。</p></div><button className="button danger-button" onClick={onDeleteFund}>删除当前基金及关联记录</button></section>
  </div>;
}

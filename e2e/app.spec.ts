import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 每个测试独立浏览器上下文，IndexedDB 初始为空。

async function createFund(page: Page, name = '宽基 ETF', code = '510300') {
  await page.goto('/');
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill(name);
  await page.getByPlaceholder('例如：510300').fill(code);
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存基金档案')).toBeVisible();
}

test('空状态引导创建第一只基金', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('先建立第一只场内基金')).toBeVisible();
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('医疗 ETF');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.locator('.fund-list-item', { hasText: '医疗 ETF' })).toBeVisible();
});

test('基金档案校验必填名称', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('');
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); void d.dismiss(); });
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect.poll(() => msg).toContain('请填写基金名称');
});


test('当前价格对比模块可整体收起、展开并保留本地选择', async ({ page }) => {
  await createFund(page);
  await expect(page.getByText('MACD 多空判断')).toBeVisible();
  await page.getByRole('button', { name: '收起内容' }).click();
  await expect(page.getByText('MACD 多空判断')).toHaveCount(0);
  await expect(page.locator('.comparison-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开内容' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('MACD 多空判断')).toHaveCount(0);
  await page.getByRole('button', { name: '展开内容' }).click();
  await expect(page.getByText('MACD 多空判断')).toBeVisible();
  await expect(page.locator('.comparison-card', { hasText: '日 BOLL 区间位置' })).toBeVisible();
});

test('五个基准 + 当前价生成正确涨跌幅和十档阶梯', async ({ page }) => {
  await createFund(page);
  await page.getByPlaceholder('输入上轨').fill('10.800');
  await page.getByPlaceholder('输入中轨').fill('10.000');
  await page.getByPlaceholder('输入下轨').fill('9.200');
  await page.getByPlaceholder('输入昨日收盘价').fill('10.500');
  await page.getByPlaceholder('输入上一笔成交价').fill('10.500');
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.950');

  await expect(page.locator('.comparison-card', { hasText: 'BOLL 中轨' }).locator('strong')).toHaveText('+9.50%');
  await expect(page.locator('.comparison-card', { hasText: '昨日收盘价' }).locator('strong')).toHaveText('+4.29%');
  await expect(page.locator('.comparison-card', { hasText: '日 BOLL 区间位置' }).locator('strong')).toHaveText('109.38%');

  // 默认基准 = 上次成交价 10.5：+4% 已越过，+5% 下一档
  await expect(page.getByText('下一档：+5% · 11.025 元')).toBeVisible();
  await expect(page.locator('.ladder-table tbody tr', { hasText: '+4%' }).getByText('已越过')).toBeVisible();
  await expect(page.locator('.ladder-table tbody tr', { hasText: '+5%' }).getByText('下一档')).toBeVisible();

  await page.getByRole('button', { name: '下跌 1%—10%' }).click();
  const firstRow = page.locator('.ladder-table tbody tr').first();
  await expect(firstRow.getByText('下一档')).toBeVisible();
  await expect(firstRow.locator('td').nth(1)).toHaveText('10.395');
});

test('交易记账计算持仓与盈亏，并拒绝超卖', async ({ page }) => {
  await createFund(page, '交易基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();

  const alerts: string[] = [];
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss(); });

  // 买入 100 @ 10，佣金 1
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('100 份');
  await expect(page.locator('.metric', { hasText: '剩余持仓成本' }).locator('strong')).toHaveText('¥1001.04');

  // 卖出 40 @ 13，佣金 1
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByRole('button', { name: '卖出' }).click();
  await page.getByLabel('成交价格（元/份）').fill('13');
  await page.getByPlaceholder('例如 1000').fill('40');
  await page.getByRole('spinbutton', { name: '佣金（0.015%）' }).fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('60 份');
  await expect(page.locator('.metric', { hasText: '已实现盈亏' }).locator('strong')).toHaveText('¥118.56');
  await expect(page.locator('.metric', { hasText: '剩余持仓成本' }).locator('strong')).toHaveText('¥600.62');

  // 超卖 61 份被拒绝
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByRole('button', { name: '卖出' }).click();
  await page.getByLabel('成交价格（元/份）').fill('13');
  await page.getByPlaceholder('例如 1000').fill('61');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect.poll(() => alerts.join('\n')).toContain('超过当时持仓');
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('60 份');
});

test('统一固定费率自动估算佣金和其他费用，并按分四舍五入', async ({ page }) => {
  await createFund(page, '固定费率基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('0.15');
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('0.04');

  await page.getByLabel('成交价格（元/份）').fill('20');
  await page.getByPlaceholder('例如 1000').fill('1');
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('0.00');

  await page.getByLabel('成交价格（元/份）').fill('125');
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('0.01');
  await page.getByRole('button', { name: '按固定费率重算' }).click();
  await page.getByRole('button', { name: '取消' }).click();
});

test('价格快照保存后出现在历史页', async ({ page }) => {
  await createFund(page, '快照基金', '510300');
  await page.getByPlaceholder('输入上轨').fill('1.050');
  await page.getByPlaceholder('输入你看到的最新价格').fill('1.000');
  await page.getByPlaceholder('备注（可选）').fill('测试快照');
  await page.getByRole('button', { name: '保存价格快照' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  await page.getByRole('button', { name: '历史与备份' }).click();
  await expect(page.getByText('测试快照')).toBeVisible();
});

test('JSON 导出、CSV 导出与导入恢复', async ({ page }) => {
  await createFund(page, '备份基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await page.getByRole('button', { name: '历史与备份' }).click();

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const json = JSON.parse(readFileSync(await (await jsonDownload).path(), 'utf8'));
  expect(json.funds.length).toBe(1);
  expect(json.trades.length).toBe(1);

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const csvText = readFileSync(await (await csvDownload).path(), 'utf8');
  expect(csvText.startsWith('﻿')).toBe(true);
  expect(csvText).toContain('基金名称');
  expect(csvText).toContain('备份基金');

  const empty = { schemaVersion: 1, funds: [], trades: [], snapshots: [] };
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file]').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await expect(page.getByText('备份已载入')).toBeVisible();
  await expect(page.getByText('先建立第一只场内基金')).toBeVisible();
});

test('拒绝结构非法的备份文件（不崩白屏）', async ({ page }) => {
  await createFund(page, '受保护基金', '510300');
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); void d.dismiss(); });
  const bad = {
    schemaVersion: 1,
    funds: [{ id: 'x', name: '差基金', code: '', market: '沪市', category: 'ETF', tickSize: '0.001', commissionRatePercent: '', minimumCommission: '', applyMinimumCommission: false, prices: { upper: '', middle: '', lower: '', previousClose: '', lastTradePrice: '', currentPrice: '' }, notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    trades: [],
    snapshots: [{ id: 's1', fundId: 'x', createdAt: '2026-01-01T00:00:00.000Z', tradingDate: '2026-01-01', prices: { upper: '', middle: '', lower: '', previousClose: '', lastTradePrice: '', currentPrice: '' }, tickSize: '0.001', note: { evil: true } }],
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect.poll(() => msg).toContain('文件结构不符合');
  await expect(page.locator('.fund-list-item', { hasText: '受保护基金' })).toBeVisible();
});

test('移动端视口布局可用、无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createFund(page, '移动基金', '510300');
  await page.getByPlaceholder('输入上轨').fill('1.050');
  await page.getByPlaceholder('输入你看到的最新价格').fill('1.000');
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/mobile-calculator.png', fullPage: true });
  await page.getByRole('button', { name: '交易账本' }).click();
  await expect(page.locator('.metric', { hasText: '当前持仓' })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-ledger.png', fullPage: true });
});

test('移动端能新增第二只基金（侧边栏入口在手机上被隐藏）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createFund(page, '第一只', '510300');
  await page.locator('.page-fund-tools').getByRole('button', { name: '＋ 新增' }).click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('第二只');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存基金档案')).toBeVisible();
  await expect(page.getByLabel('当前基金')).toContainText('第二只');
});
test('侧边栏可收起为图标并可恢复', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFund(page, '折叠导航基金', '510300');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.workspace')).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole('button', { name: '价格计算' })).toBeVisible();
  await expect(page.locator('.sidebar.collapsed .nav-item').first()).toBeVisible();
  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await expect(page.locator('.workspace')).not.toHaveClass(/sidebar-collapsed/);
});

test('页头上一只和下一只基金按钮切换当前 ETF', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFund(page, '第一只ETF', '510300');
  await page.locator('.page-fund-tools').getByRole('button', { name: '＋ 新增' }).click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('第二只ETF');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('第二只ETF');
  await page.getByRole('button', { name: '上一只基金' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('第一只ETF');
  await page.getByRole('button', { name: '下一只基金' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('第二只ETF');
});


function currentMarketTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}
// Real Eastmoney f86 is a Unix-seconds epoch (10 digits), as observed live on 2026-10-19.
function currentMarketEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function mockTencentQuote(code = '510300'): string {
  const fields = Array.from({ length: 50 }, () => '');
  fields[0] = '1';
  fields[1] = '沪深300ETF';
  fields[2] = code;
  fields[3] = '4.125';
  fields[4] = '4.000';
  fields[30] = currentMarketTimestamp();
  fields[32] = '3.13';
  return 'v_sh' + code + '="' + fields.join('~') + '";';
}

test('行情仅在手动点击时请求，东方财富成功后更新当前价与当日涨跌幅', async ({ page }) => {
  let eastmoneyCalls = 0;
  let tencentCalls = 0;
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    eastmoneyCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: currentMarketEpoch() } }),
    });
  });
  await page.route('https://qt.gtimg.cn/**', async (route) => {
    tencentCalls += 1;
    await route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: mockTencentQuote() });
  });
  await page.route('https://push2his.eastmoney.com/**', async (route) => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const lines = Array.from({ length: 25 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (24 - index));
      const dateText = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
      const close = (4 + index * 0.001).toFixed(3);
      return [dateText, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',');
    });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { code: '510300', klines: lines } }),
    });
  });
  await createFund(page, '行情测试 ETF', '510300');

  expect(eastmoneyCalls).toBe(0);
  expect(tencentCalls).toBe(0);
  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByPlaceholder('输入你看到的最新价格')).toHaveValue('4.125');
  await expect(page.getByRole('spinbutton', { name: '昨日收盘价' })).toHaveValue('4.000');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 上轨' })).not.toHaveValue('');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 中轨' })).not.toHaveValue('');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 下轨' })).not.toHaveValue('');
  await expect(page.getByText('日涨跌 +3.13%', { exact: true })).toBeVisible();
  await expect(page.getByText(/来源：东方财富/)).toBeVisible();
  await expect(page.locator('.quote-refresh-meta').getByText(/BOLL\(20,2\)/)).toBeVisible();
  expect(eastmoneyCalls).toBe(1);
  expect(tencentCalls).toBe(0);
});

test('东方财富失败时腾讯自动兜底，双源都失败时保留手动价格', async ({ page }) => {
  await createFund(page, '双源测试 ETF', '510300');
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'unavailable' });
  });
  await page.route('https://qt.gtimg.cn/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: mockTencentQuote() });
  });
  await page.route('https://push2his.eastmoney.com/**', async (route) => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const lines = Array.from({ length: 25 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (24 - index));
      const dateText = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
      const close = (4 + index * 0.001).toFixed(3);
      return [dateText, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',');
    });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { code: '510300', klines: lines } }),
    });
  });

  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByPlaceholder('输入你看到的最新价格')).toHaveValue('4.125');
  await expect(page.getByText(/来源：腾讯行情/)).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '昨日收盘价' })).toHaveValue('4.000');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 中轨' })).not.toHaveValue('');

  await page.getByPlaceholder('输入你看到的最新价格').fill('3.500');
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'unavailable' });
  });
  await page.route('https://qt.gtimg.cn/**', async (route) => {
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'unavailable' });
  });
  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByPlaceholder('输入你看到的最新价格')).toHaveValue('3.500');
  await expect(page.getByText(/保留上次成功报价|未覆盖当前价格/)).toBeVisible();
});


test('刷新写入的现价、昨收和 BOLL 轨道仍可手动改写', async ({ page }) => {
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: currentMarketEpoch() } }),
    });
  });
  await page.route('https://push2his.eastmoney.com/**', async (route) => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const lines = Array.from({ length: 25 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (24 - index));
      const dateText = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
      const close = (4 + index * 0.001).toFixed(3);
      return [dateText, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',');
    });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { code: '510300', klines: lines } }),
    });
  });
  await createFund(page, '可编辑价格 ETF', '510300');
  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByRole('spinbutton', { name: '昨日收盘价' })).toHaveValue('4.000');
  await page.getByRole('spinbutton', { name: '当前价格' }).fill('4.200');
  await page.getByRole('spinbutton', { name: '昨日收盘价' }).fill('3.900');
  await page.getByRole('spinbutton', { name: 'BOLL 上轨' }).fill('4.500');
  await page.getByRole('spinbutton', { name: 'BOLL 中轨' }).fill('4.100');
  await page.getByRole('spinbutton', { name: 'BOLL 下轨' }).fill('3.700');
  await expect(page.getByRole('spinbutton', { name: '当前价格' })).toHaveValue('4.200');
  await expect(page.getByRole('spinbutton', { name: '昨日收盘价' })).toHaveValue('3.900');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 上轨' })).toHaveValue('4.500');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 中轨' })).toHaveValue('4.100');
  await expect(page.getByRole('spinbutton', { name: 'BOLL 下轨' })).toHaveValue('3.700');
  await expect(page.getByText(/价格字段已手动修改/)).toBeVisible();
});


test('各 ETF 独立保存阶梯基准和方向，切换及重载后不串用', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFund(page, 'ETF A', '510300');
  await page.getByLabel('选择计算基准').selectOption('lower');
  await page.getByRole('button', { name: '下跌 1%—10%' }).click();

  await page.locator('.page-fund-tools').getByRole('button', { name: '＋ 新增' }).click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('ETF B');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByLabel('选择计算基准')).toHaveValue('lastTradePrice');
  await expect(page.getByRole('button', { name: '上涨 1%—10%' })).toHaveClass(/active/);

  await page.getByLabel('选择计算基准').selectOption('middle');
  await page.getByRole('button', { name: '上一只基金' }).click();
  await expect(page.getByLabel('选择计算基准')).toHaveValue('lower');
  await expect(page.getByRole('button', { name: '下跌 1%—10%' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '上涨 1%—10%' })).not.toHaveClass(/active/);

  await page.getByRole('button', { name: '下一只基金' }).click();
  await expect(page.getByLabel('选择计算基准')).toHaveValue('middle');
  await expect(page.getByRole('button', { name: '上涨 1%—10%' })).toHaveClass(/active/);
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await page.reload();

  // Startup selects the first ETF, but its own saved preferences must be restored.
  await expect(page.getByLabel('选择计算基准')).toHaveValue('lower');
  await expect(page.getByRole('button', { name: '下跌 1%—10%' })).toHaveClass(/active/);
  await page.getByRole('button', { name: '下一只基金' }).click();
  await expect(page.getByLabel('选择计算基准')).toHaveValue('middle');
  await expect(page.getByRole('button', { name: '上涨 1%—10%' })).toHaveClass(/active/);
});


test('刷新进行中用户改写现价，返回后不被行情覆盖且提示手动修改', async ({ page }) => {
  let releaseQuote!: () => void;
  const firstQuoteGate = new Promise<void>((resolve) => { releaseQuote = resolve; });
  let firstQuoteHeld = true;
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    if (firstQuoteHeld) {
      firstQuoteHeld = false;
      // Hold the first request until the test releases it.
      await firstQuoteGate;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: currentMarketEpoch() } }),
    });
  });
  await page.route('https://qt.gtimg.cn/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.route('https://push2his.eastmoney.com/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await createFund(page, '手动编辑竞态 ETF', '510300');

  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByRole('button', { name: '刷新行情' })).toBeDisabled();
  // User types their own price while the quote request is still in flight.
  await page.getByRole('spinbutton', { name: '当前价格' }).fill('9.888');
  await expect(page.getByText(/价格字段已手动修改/)).toBeVisible();

  releaseQuote!();
  await expect(page.getByText(/来源：东方财富/)).toBeVisible();

  // The quote must NOT clobber the user's manual edit.
  await expect(page.getByRole('spinbutton', { name: '当前价格' })).toHaveValue('9.888');
  await expect(page.getByText(/价格字段已手动修改/)).toBeVisible();
  await expect(page.getByPlaceholder('昨日收盘价')).toHaveValue('4.000');
});

test('BOLL 区间位置显示 0%/100%/超界与无效输入的诚实降级', async ({ page }) => {
  await createFund(page, '区间位置 ETF', '510300');
  // getByRole('spinbutton', { name: 'BOLL 下轨' }) also matches the basis <select> whose option text contains it; pin the spinbuttons.
  const fill = (label: string, value: string) => page.getByRole('spinbutton', { name: label }).fill(value);
  // 无效输入：上轨 ≤ 下轨 → 诚实显示待输入而非伪百分比
  await fill('BOLL 下轨', '4.000');
  await fill('BOLL 上轨', '4.000');
  await expect(page.getByText('日 BOLL 区间位置')).toBeVisible();
  await expect(page.getByText('待输入有效价格/轨道')).toBeVisible();

  // 日 BOLL 只在 0%/100% 边界切换数值颜色；周/月的 50% 规则单独测试。
  // 边界：当前价=下轨 → 0%；当前价=上轨 → 100%
  const positionCard = page.locator('.comparison-card').filter({ hasText: '日 BOLL 区间位置' });
  await fill('BOLL 上轨', '5.000');
  await fill('当前价格', '4.500');
  await expect(positionCard.locator('strong')).toHaveText('50.00%');
  await expect(positionCard.locator('strong')).not.toHaveClass(/daily-position-red|daily-position-green/);
  await expect(positionCard).not.toHaveClass(/position-heat-red|position-heat-green/);
  await fill('当前价格', '4.000');
  await expect(page.getByText('当前价位于下轨')).toBeVisible();
  await expect(positionCard).toContainText('0.00%');
  await fill('当前价格', '5.000');
  await expect(page.getByText('当前价位于上轨')).toBeVisible();
  await expect(positionCard).toContainText('100.00%');
  // 超界：高于上轨 > 100%，低于下轨 < 0%
  await fill('当前价格', '5.500');
  await expect(positionCard).toContainText('150.00%');
  await expect(page.getByText('当前价高于上轨')).toBeVisible();
  await fill('当前价格', '3.500');
  await expect(positionCard).toContainText('-50.00%');
  await expect(page.getByText('当前价低于下轨')).toBeVisible();
});


test('周/月 BOLL 区间位置独立取轨道并按 50% 分色，日 BOLL 按 0/100% 分色', async ({ page }) => {
  await page.route('https://push2.eastmoney.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '10.000', f60: '10.000', f86: currentMarketEpoch() } }) }));
  await page.route('https://qt.gtimg.cn/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.route('https://push2his.eastmoney.com/**', async (route) => {
    const klt = new URL(route.request().url()).searchParams.get('klt');
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(currentMarketEpoch() * 1000));
    const marketDate = `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
    const anchor = new Date(`${marketDate}T00:00:00.000Z`);
    let dates: string[];
    let base: number;
    if (klt === '102') {
      anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
      dates = Array.from({ length: 20 }, (_, i) => { const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() - (19 - i) * 7); return d.toISOString().slice(0, 10); });
      base = 9;
    } else if (klt === '103') {
      const [year, month] = marketDate.split('-').map(Number);
      dates = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(year, month - 1 - (19 - i), 1)).toISOString().slice(0, 10));
      base = 11;
    } else {
      dates = Array.from({ length: 25 }, (_, i) => { const d = new Date(anchor); d.setUTCDate(anchor.getUTCDate() - (24 - i)); return d.toISOString().slice(0, 10); });
      base = 9;
    }
    const klines = dates.map((date, i) => {
      const close = klt === '101' ? (i % 2 ? '11.000' : '9.000')
        : klt === '102' ? (i === 18 ? '10.000' : i < 18 && i % 2 ? '11.000' : '9.000')
        : base.toFixed(3);
      return [date, close, close, close, close, '0', '0', '0', '0', '0', '0'].join(',');
    });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { code: '510300', klines } }) });
  });
  await createFund(page, '周月测试基金', '510300');
  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByText(/已刷新 .*东方财富/)).toBeVisible();
  const weekly = page.locator('.comparison-card').filter({ hasText: '周 BOLL 区间位置' });
  const monthly = page.locator('.comparison-card').filter({ hasText: '月 BOLL 区间位置' });
  await expect(weekly).toHaveClass(/position-heat-red/);
  await expect(weekly).toContainText('50.00%'); // 等于阈值时也必须红色
  await expect(monthly).toHaveClass(/position-heat-green/);
  await expect(weekly.locator('strong')).toHaveCSS('color', 'rgb(182, 76, 76)');
  await expect(monthly.locator('strong')).toHaveCSS('color', 'rgb(20, 123, 103)');
  const daily = page.locator('.comparison-card').filter({ hasText: '日 BOLL 区间位置' });
  await page.getByPlaceholder('输入下轨').fill('9.000');
  await page.getByPlaceholder('输入上轨').fill('11.000');
  await page.getByPlaceholder('输入你看到的最新价格').fill('11.000');
  await expect(daily.locator('strong')).toHaveClass(/daily-position-red/);
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.000');
  await expect(daily.locator('strong')).not.toHaveClass(/daily-position-red|daily-position-green/); // 日位置 50% 不触发颜色规则
  await page.getByPlaceholder('输入你看到的最新价格').fill('9.000');
  await expect(daily.locator('strong')).toHaveClass(/daily-position-green/);
  await expect(daily).not.toHaveClass(/position-heat-red|position-heat-green/);
});

test('价格基准输入框对齐，当前价格与普通价格框高度一致', async ({ page }) => {
  await createFund(page, '输入对齐测试基金', '510300');
  const measurements = await Promise.all(['输入下轨', '输入昨日收盘价', '输入上一笔成交价', '输入你看到的最新价格'].map(async (placeholder) => page.getByPlaceholder(placeholder).evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height }; })));
  const heights = measurements.map((m) => m.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  const gaps = await Promise.all(['BOLL 下轨', '昨日收盘价', '上一次成交价', '当前价格'].map(async (label) => page.getByRole('spinbutton', { name: label }).evaluate((el) => { const labelEl = el.closest('label')!.querySelector('span')!; return el.getBoundingClientRect().top - labelEl.getBoundingClientRect().bottom; })));
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
});

test('手动改过费用后改数量不覆盖输入，重算按钮显式恢复估算', async ({ page }) => {
  await createFund(page, '费用守卫 ETF', '510300');
  await page.getByRole('button', { name: '交易账本', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新增交易' }).click();
  await page.getByLabel('成交价格（元/份）').fill('4.000');
  await page.getByLabel('成交数量（份，整数）').fill('10000');
  // Auto-estimate fills first: 10000 × 4.000 × 0.015% = ¥6.00.
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('6.00');
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('1.60');

  // User overrides commission to 0 (broker waiver) — a manual fee decision.
  await page.getByLabel('佣金（0.015%）').fill('0');
  // User then fixes a quantity typo; the manual fee must survive.
  await page.getByLabel('成交数量（份，整数）').fill('12000');
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('0');
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('1.92');

  // The explicit recompute button restores the estimates on demand.
  await page.getByRole('button', { name: '按固定费率重算' }).click();
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('7.20');
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('1.92');
});

// ============ 补齐缺口：交互层审查列出的 13 条 ============

test('删除基金级联删除交易与快照，选中回退且 reload 不复活', async ({ page }) => {
  await createFund(page, '留存款', '510300');
  // 第二只基金（成为当前选中）
  await page.locator('.page-fund-tools').getByRole('button', { name: '＋ 新增' }).click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('删除款');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('删除款');

  // 当前基金（删除款）加 1 笔交易
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('5');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  // 当前基金保存 1 条快照
  await page.getByRole('button', { name: '价格计算' }).click();
  await page.getByPlaceholder('输入上轨').fill('5.500');
  await page.getByPlaceholder('输入你看到的最新价格').fill('5.100');
  await page.getByPlaceholder('备注（可选）').fill('删除款的快照');
  await page.getByRole('button', { name: '保存价格快照' }).click();
  await expect(page.getByText(/已保存 \d{4}-\d{2}-\d{2} 的价格快照/)).toBeVisible();

  // 删除当前基金（confirm 接受）
  await page.getByRole('button', { name: '历史与备份' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除当前基金及关联记录' }).click();

  // 选中回退到剩余基金
  await expect(page.getByLabel('当前基金')).toContainText('留存款');
  // 交易与快照消失
  await expect(page.locator('.snapshot-card', { hasText: '删除款的快照' })).toHaveCount(0);
  await expect(page.locator('.fund-list-item', { hasText: '删除款' })).toHaveCount(0);

  // 导出 JSON 验证级联（trades/snapshots 已清空）
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const json = JSON.parse(readFileSync(await (await downloadPromise).path(), 'utf8'));
  expect(json.funds.length).toBe(1);
  expect(json.funds[0].name).toBe('留存款');
  expect(json.trades.length).toBe(0);
  expect(json.snapshots.length).toBe(0);

  // reload 后被删基金不复活
  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await page.reload();
  await expect(page.locator('.fund-list-item', { hasText: '留存款' })).toBeVisible();
  await expect(page.locator('.fund-list-item', { hasText: '删除款' })).toHaveCount(0);
});

test('含快照的完整备份导出后重新导入可全部恢复', async ({ page }) => {
  await createFund(page, '备份基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await page.getByRole('button', { name: '价格计算' }).click();
  await page.getByPlaceholder('输入上轨').fill('10.800');
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.500');
  await page.getByPlaceholder('备注（可选）').fill('恢复用快照');
  await page.getByRole('button', { name: '保存价格快照' }).click();
  await expect(page.getByText(/已保存 \d{4}-\d{2}-\d{2} 的价格快照/)).toBeVisible();

  // 导出完整备份并落盘
  await page.getByRole('button', { name: '历史与备份' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadPromise;
  await download.saveAs('test-results/full-backup.json');
  const backupText = readFileSync('test-results/full-backup.json', 'utf8');
  const backup = JSON.parse(backupText);
  expect(backup.funds.length).toBe(1);
  expect(backup.trades.length).toBe(1);
  expect(backup.snapshots.length).toBe(1);

  // 清空重建场景
  const empty = { schemaVersion: 1, funds: [], trades: [], snapshots: [] };
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file]').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await expect(page.getByText('备份已载入')).toBeVisible();
  await expect(page.getByText('先建立第一只场内基金')).toBeVisible();

  // 重新导入完整备份文件（用导出的原始字节）
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file]').setInputFiles({ name: 'full-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
  await expect(page.getByText('备份已载入')).toBeVisible();

  // 基金、交易、快照全部恢复
  await expect(page.locator('.fund-list-item', { hasText: '备份基金' })).toBeVisible();
  await page.getByRole('button', { name: '交易账本' }).click();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('100 份');
  await page.getByRole('button', { name: '历史与备份' }).click();
  await expect(page.locator('.snapshot-card', { hasText: '恢复用快照' })).toBeVisible();
});

test('恶意备份变体被拒绝且数据不变，非法 ladderBasis 被 normalize 兜底', async ({ page }) => {
  await createFund(page, '防线基金', '510300');
  const alerts: string[] = [];
  page.on('dialog', (d) => {
    alerts.push(d.message());
    void (d.type() === 'confirm' ? d.accept() : d.dismiss());
  });

  const validFund = () => ({
    id: 'f1', name: '规范化基金', code: '510300', market: '沪市', category: 'ETF', tickSize: '0.001',
    prices: { upper: '', middle: '', lower: '', previousClose: '', lastTradePrice: '', currentPrice: '' },
    ladderBasis: 'lastTradePrice', ladderDirection: 'up', notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const validTrade = (fundId: string, overrides: Record<string, unknown> = {}) => ({
    id: 't1', fundId, tradedAt: '2026-01-02T10:00', side: 'BUY', price: '10', quantity: '100',
    commission: '1', transferFee: '0', stampDuty: '0', otherFee: '0', feesChecked: false, note: '',
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...overrides,
  });
  const importJson = async (payload: unknown) => {
    alerts.length = 0;
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    // 等待本次导入的响应：alert 或成功 toast
    await expect.poll(async () => alerts.length > 0 || await page.getByText('备份已载入').isVisible()).toBe(true);
  };
  const dataUnchanged = async () => {
    await expect(page.locator('.fund-list-item', { hasText: '防线基金' })).toBeVisible();
    await expect(page.locator('.fund-list-item', { hasText: '规范化基金' })).toHaveCount(0);
  };

  // 变体 1：trade.fundId 指向不存在的基金
  await importJson({ schemaVersion: 1, funds: [validFund()], trades: [validTrade('ghost')], snapshots: [] });
  await expect.poll(() => alerts.join('\n')).toContain('文件结构不符合');
  await dataUnchanged();

  // 变体 2：两条相同 fund.id
  await importJson({ schemaVersion: 1, funds: [validFund(), validFund()], trades: [], snapshots: [] });
  await expect.poll(() => alerts.join('\n')).toContain('文件结构不符合');
  await dataUnchanged();

  // 变体 3：负数佣金
  await importJson({ schemaVersion: 1, funds: [validFund()], trades: [validTrade('f1', { commission: '-1' })], snapshots: [] });
  await expect.poll(() => alerts.join('\n')).toContain('文件结构不符合');
  await dataUnchanged();

  // 变体 4：ladderBasis 非法值 → 导入成功且 normalize 兜底为 lastTradePrice
  const hacked: Record<string, unknown> = { ...validFund(), ladderBasis: 'hack' };
  await importJson({ schemaVersion: 1, funds: [hacked], trades: [], snapshots: [] });
  await expect(page.locator('.fund-list-item', { hasText: '规范化基金' })).toBeVisible();
  await expect(page.getByLabel('选择计算基准')).toHaveValue('lastTradePrice');
});

test('刷新行情按钮连点两次只发出一次 eastmoney 请求', async ({ page }) => {
  let eastmoneyCalls = 0;
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    eastmoneyCalls += 1;
    // 轻微延迟让 loading 状态可被观察
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: currentMarketEpoch() } }),
    });
  });
  await page.route('https://qt.gtimg.cn/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.route('https://push2his.eastmoney.com/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await createFund(page, '连点测试 ETF', '510300');

  const refreshButton = page.getByRole('button', { name: '刷新行情' });
  await refreshButton.click();
  // 第一次点击后按钮立即 disabled（防并发）
  await expect(refreshButton).toBeDisabled();
  // 立即再点：disabled 元素的原生 click() 不会触发 handler
  await refreshButton.evaluate((button) => (button as HTMLButtonElement).click());

  await expect(page.getByText(/来源：东方财富/)).toBeVisible();
  expect(eastmoneyCalls).toBe(1);
});

test('刷新进行中编辑基金代码，旧响应不写入新代码基金的价格', async ({ page }) => {
  let releaseQuote!: () => void;
  const quoteGate = new Promise<void>((resolve) => { releaseQuote = resolve; });
  let quoteHeld = true;
  await page.route('https://push2.eastmoney.com/**', async (route) => {
    if (quoteHeld) {
      quoteHeld = false;
      await quoteGate;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { f57: '510300', f58: '沪深300ETF', f43: '4.125', f60: '4.000', f86: currentMarketEpoch() } }),
    });
  });
  await page.route('https://qt.gtimg.cn/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.route('https://push2his.eastmoney.com/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await createFund(page, '改码竞态 ETF', '510300');

  await page.getByRole('button', { name: '刷新行情' }).click();
  await expect(page.getByRole('button', { name: '刷新行情' })).toBeDisabled();

  // in-flight 中编辑档案改代码保存
  await page.getByRole('button', { name: '编辑档案' }).click();
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存基金档案')).toBeVisible();

  // 放行旧请求（响应携带旧代码 510300 的数据）
  releaseQuote();
  await expect(page.getByText(/已刷新 .*（东方财富）/)).toBeVisible();

  // 新代码基金的价格不被旧响应写入
  await expect(page.getByPlaceholder('输入你看到的最新价格')).toHaveValue('');
  await expect(page.getByText(/来源：东方财富/)).toHaveCount(0);
  // 旧 loading 状态不得锁死新代码的刷新按钮
  await expect(page.getByRole('button', { name: '刷新行情' })).toBeEnabled();
});

test('删除最新交易后持仓重算且上一次成交价回退到次新', async ({ page }) => {
  await createFund(page, '回退测试基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();

  // 第一笔：100 @ 10
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交日期和时间').fill('2026-01-02T10:00');
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  // 第二笔（最新）：100 @ 12
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交日期和时间').fill('2026-01-03T10:00');
  await page.getByLabel('成交价格（元/份）').fill('12');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('200 份');

  // 删除最新一笔（列表第一行，tradedAt 降序）
  page.once('dialog', (d) => d.accept());
  await page.locator('tbody tr').first().getByText('删除').click();
  await expect(page.getByText('交易记录已删除并重新计算。')).toBeVisible();

  // 持仓重算
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('100 份');
  // 上一次成交价回退到次新成交价
  await page.getByRole('button', { name: '价格计算' }).click();
  await expect(page.getByPlaceholder('输入上一笔成交价')).toHaveValue('10');
});

test('编辑交易回填正确、保存后数量更新且费用不被自动估算覆盖', async ({ page }) => {
  await createFund(page, '编辑测试基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('4.000');
  await page.getByPlaceholder('例如 1000').fill('100');
  // 佣金手动改写（若编辑路径被重新估算会是 0.06）
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  // 打开编辑：initial 回填正确，费用是原值而非重新估算
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('成交价格（元/份）')).toHaveValue('4.000');
  await expect(page.getByLabel('成交数量（份，整数）')).toHaveValue('100');
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('1');
  // 4.000×100×0.004% = 0.016 元，按分四舍五入 0.02：编辑框回填保存值而非重新估算
  await expect(page.getByLabel('其他费用（0.004%）')).toHaveValue('0.02');

  // 修改数量保存 → 列表与再次打开编辑框都应看到新数量
  await page.getByLabel('成交数量（份，整数）').fill('200');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td').nth(3)).toHaveText('200');

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('成交数量（份，整数）')).toHaveValue('200');
  await expect(page.getByLabel('佣金（0.015%）')).toHaveValue('1');
});

test('IndexedDB 被破坏时显示本地保存异常警告而非白屏', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); } });
  });
  await page.goto('/');
  // 不白屏：应用外壳照常渲染
  await expect(page.getByText('基金阶梯账本').first()).toBeVisible();
  await expect(page.getByText('先建立第一只场内基金')).toBeVisible();
  // 显示本地保存异常警告横幅
  await expect(page.locator('.storage-warning')).toContainText('本地保存异常');
  // 界面仍可用（内存态）
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('降级基金');
  await page.getByPlaceholder('例如：510300').fill('510300');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.locator('.fund-list-item', { hasText: '降级基金' })).toBeVisible();
});

test('持仓盈亏汇总页与手算一致，打开按钮跳转对应基金计算页', async ({ page }) => {
  await createFund(page, '基金甲', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByLabel('其他费用（0.004%）').fill('0');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  await page.locator('.page-fund-tools').getByRole('button', { name: '＋ 新增' }).click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('基金乙');
  await page.getByPlaceholder('例如：510300').fill('512170');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存基金档案')).toBeVisible();
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('5');
  await page.getByPlaceholder('例如 1000').fill('200');
  await page.getByLabel('佣金（0.015%）').fill('1');
  await page.getByLabel('其他费用（0.004%）').fill('0');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  // 各自输入当前价：乙 4 元，甲 12 元
  await page.getByRole('button', { name: '价格计算' }).click();
  await page.getByPlaceholder('输入你看到的最新价格').fill('4');
  await page.getByRole('button', { name: '上一只基金' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('基金甲');
  await page.getByPlaceholder('输入你看到的最新价格').fill('12');

  // 汇总手算：甲成本 1000+1=1001.00 市值 1200.00 浮动 +199.00
  //           乙成本 1000+1=1001.00 市值  800.00 浮动 -201.00
  //           汇总 成本 2002.00 市值 2000.00 浮动 -2.00
  await page.getByRole('button', { name: '持仓盈亏' }).click();
  await expect(page.locator('.metric', { hasText: '剩余持仓成本' }).locator('strong')).toHaveText('¥2002.00');
  await expect(page.locator('.metric', { hasText: '当前参考市值' }).locator('strong')).toHaveText('¥2000.00');
  await expect(page.locator('.metric', { hasText: '浮动盈亏' }).locator('strong')).toHaveText('-¥2.00');

  // 「打开」跳转到对应基金计算页
  await page.locator('tbody tr', { hasText: '基金乙' }).getByText('打开').click();
  await expect(page.getByText('十档价格阶梯')).toBeVisible();
  await expect(page.getByLabel('当前基金')).toContainText('基金乙');
});

test('CSV 导出对逗号、引号和换行的备注正确转义', async ({ page }) => {
  const exportCsvText = async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV' }).click();
    return readFileSync(await (await downloadPromise).path(), 'utf8');
  };
  await createFund(page, '备份转义基金', '510300');
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByLabel('交易备注').fill('逗号,引号"');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();

  await page.getByRole('button', { name: '历史与备份' }).click();
  const uiCsv = await exportCsvText();
  // 每个字段被双引号包裹，备注内的逗号保留在引号内、内部引号翻倍
  expect(uiCsv).toContain('"备份转义基金","510300"');
  expect(uiCsv).toContain('"待核对","逗号,引号"""');

  // 真实换行无法经单行 input 键入（浏览器剥离），经备份导入通道注入含换行的备注后导出
  const backupWithNewlineNote = {
    schemaVersion: 1,
    funds: [{
      id: 'f1', name: '换行基金', code: '510300', market: '沪市', category: 'ETF', tickSize: '0.001',
      prices: { upper: '', middle: '', lower: '', previousClose: '', lastTradePrice: '', currentPrice: '' },
      ladderBasis: 'lastTradePrice', ladderDirection: 'up', notes: '',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    trades: [{
      id: 't1', fundId: 'f1', tradedAt: '2026-01-02T10:00', side: 'BUY', price: '10', quantity: '100',
      commission: '1', transferFee: '0', stampDuty: '0', otherFee: '0', feesChecked: false,
      note: '首行\n次行', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    }],
    snapshots: [],
  };
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file]').setInputFiles({ name: 'newline-note.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupWithNewlineNote)) });
  await expect(page.getByText('备份已载入')).toBeVisible();
  const newlineCsv = await exportCsvText();
  // 换行被保留在双引号包裹的字段内，CSV 行结构不被拆断
  expect(newlineCsv).toContain('"首行\n次行"');
  expect(newlineCsv).toContain('"换行基金","510300"');
});

test('reload 后基金、当前价与 BOLL 轨道输入全部恢复', async ({ page }) => {
  await createFund(page, '重载基金', '510300');
  await page.getByPlaceholder('输入上轨').fill('10.800');
  await page.getByPlaceholder('输入中轨').fill('10.000');
  await page.getByPlaceholder('输入下轨').fill('9.200');
  await page.getByPlaceholder('输入昨日收盘价').fill('10.500');
  await page.getByPlaceholder('输入上一笔成交价').fill('10.300');
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.950');

  await expect(page.locator('.save-state')).toHaveText('已保存到本机');
  await page.reload();

  await expect(page.getByPlaceholder('输入上轨')).toHaveValue('10.800');
  await expect(page.getByPlaceholder('输入中轨')).toHaveValue('10.000');
  await expect(page.getByPlaceholder('输入下轨')).toHaveValue('9.200');
  await expect(page.getByPlaceholder('输入昨日收盘价')).toHaveValue('10.500');
  await expect(page.getByPlaceholder('输入上一笔成交价')).toHaveValue('10.300');
  await expect(page.getByPlaceholder('输入你看到的最新价格')).toHaveValue('10.950');
});

test('基金代码为空时刷新行情按钮禁用', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('无代码基金');
  // 代码留空
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByText('已保存基金档案')).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新行情' })).toBeDisabled();
});

test('历史页删除快照只影响目标条目', async ({ page }) => {
  await createFund(page, '快照删除基金', '510300');
  await page.getByPlaceholder('输入上轨').fill('1.050');
  await page.getByPlaceholder('输入你看到的最新价格').fill('1.000');

  await page.getByPlaceholder('备注（可选）').fill('快照一');
  await page.getByRole('button', { name: '保存价格快照' }).click();
  await expect(page.getByText(/已保存 \d{4}-\d{2}-\d{2} 的价格快照/)).toBeVisible();

  await page.getByPlaceholder('备注（可选）').fill('快照二');
  await page.getByRole('button', { name: '保存价格快照' }).click();
  // 等第二条快照确实入库再离开页面
  await page.getByRole('button', { name: '历史与备份' }).click();
  await expect(page.locator('.snapshot-card')).toHaveCount(2);

  page.once('dialog', (d) => d.accept());
  await page.locator('.snapshot-card', { hasText: '快照一' }).getByRole('button', { name: '删除' }).click();

  await expect(page.locator('.snapshot-card', { hasText: '快照一' })).toHaveCount(0);
  await expect(page.locator('.snapshot-card', { hasText: '快照二' })).toBeVisible();
  await expect(page.locator('.snapshot-card')).toHaveCount(1);
});

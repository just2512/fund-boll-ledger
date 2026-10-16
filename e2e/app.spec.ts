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
  await page.getByLabel('实际佣金').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('100 份');
  await expect(page.locator('.metric', { hasText: '剩余持仓成本' }).locator('strong')).toHaveText('¥1001.00');

  // 卖出 40 @ 13，佣金 1
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByRole('button', { name: '卖出' }).click();
  await page.getByLabel('成交价格（元/份）').fill('13');
  await page.getByPlaceholder('例如 1000').fill('40');
  await page.getByLabel('实际佣金').fill('1');
  await page.getByRole('button', { name: '保存交易' }).click();
  await expect(page.getByText('交易明细已保存')).toBeVisible();
  await expect(page.locator('.metric', { hasText: '当前持仓' }).locator('strong')).toHaveText('60 份');
  await expect(page.locator('.metric', { hasText: '已实现盈亏' }).locator('strong')).toHaveText('¥118.60');
  await expect(page.locator('.metric', { hasText: '剩余持仓成本' }).locator('strong')).toHaveText('¥600.60');

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

test('佣金估算：费率与最低佣金生效', async ({ page }) => {
  await createFund(page, '费率基金', '510300');
  await page.getByRole('button', { name: '编辑档案' }).click();
  await page.getByPlaceholder('例如 0.025').fill('0.025');
  await page.getByPlaceholder('按账户协议填写').fill('5');
  await page.getByLabel('佣金不足最低额时按最低额估算').check();
  await page.getByRole('button', { name: '保存档案' }).click();
  await page.getByRole('button', { name: '交易账本' }).click();
  await page.getByRole('button', { name: '新增交易' }).first().click();
  await page.getByLabel('成交价格（元/份）').fill('10');
  await page.getByPlaceholder('例如 1000').fill('100');
  await page.getByRole('button', { name: '估算佣金' }).click();
  // 1000 × 0.025% = 0.25 元，被最低佣金 5 元抬升
  await expect(page.getByLabel('实际佣金')).toHaveValue('5.00');
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
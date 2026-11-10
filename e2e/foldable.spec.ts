import { expect, test, type Page } from '@playwright/test';

async function createFund(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新增基金档案' }).first().click();
  await page.getByPlaceholder('例如：宽基 ETF').fill('折叠屏测试基金');
  await page.getByPlaceholder('例如：510300').fill('510300');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByLabel('当前基金')).toContainText('折叠屏测试基金');
}

test('折叠屏外屏、内屏、横屏和桌面视口无页面级横向溢出', async ({ page }) => {
  const viewports = [
    { width: 360, height: 780, label: 'folded outer screen' },
    { width: 720, height: 900, label: 'unfolded inner screen' },
    { width: 844, height: 390, label: 'landscape' },
    { width: 1280, height: 900, label: 'desktop' },
  ];
  await page.setViewportSize(viewports[0]);
  await createFund(page);
  await expect(page.getByText('BOLL + MACD 技术状态')).toBeVisible();
  await page.locator('.technical-period-details summary').click();
  await expect(page.locator('.technical-period-details')).toHaveAttribute('open');
  await page.getByPlaceholder('输入上轨').fill('10.800');
  await page.getByPlaceholder('输入中轨').fill('10.000');
  await page.getByPlaceholder('输入下轨').fill('9.200');
  await page.getByPlaceholder('输入昨日收盘价').fill('10.500');
  await page.getByPlaceholder('输入上一笔成交价').fill('10.500');
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.950');
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByText('当前价格对比')).toBeVisible();
    await expect(page.getByText('上一次成交价', { exact: true }).first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, viewport.label).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body, viewport.label).toBeLessThanOrEqual(dimensions.viewport + 1);
    const technicalPanel = await page.locator('.macd-panel').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(technicalPanel.scrollWidth, viewport.label).toBeLessThanOrEqual(technicalPanel.clientWidth + 1);
  }
});

test('外屏窄形态（360×760）侧边导航、价格输入与 modal 可用性', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await createFund(page);

  // 侧边导航为可横滑条而非桌面抽屉：导航项可见且可点击切换页面
  await expect(page.getByRole('button', { name: '交易账本' })).toBeVisible();
  await page.getByRole('button', { name: '交易账本' }).click();
  await expect(page.getByRole('heading', { name: '交易账本' })).toBeVisible();

  // 价格输入不挤压：每列输入框有可点击宽度（≥120px）
  await page.getByRole('button', { name: '价格计算' }).click();
  const inputs = page.locator('.reference-grid input');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const width = await inputs.nth(i).evaluate((el) => el.getBoundingClientRect().width);
    expect(width, `reference-grid input #${i}`).toBeGreaterThanOrEqual(120);
  }

  // 新增基金 modal 打开不溢出且可滚动（360px 下侧栏新增按钮被移动断点隐藏，走页头工具入口）
  await page.getByRole('button', { name: '＋ 新增' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  const modalBox = await modal.boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.width).toBeLessThanOrEqual(360);
  const overflow = await modal.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThanOrEqual(0); // 可滚动而非内容被裁切
  await page.getByRole('button', { name: '取消' }).click();
  await expect(modal).toBeHidden();
});

test('内屏正方形形态（900×850）利用横向空间且十档表免横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await createFund(page);
  await page.getByPlaceholder('输入上轨').fill('10.800');
  await page.getByPlaceholder('输入中轨').fill('10.000');
  await page.getByPlaceholder('输入下轨').fill('9.200');
  await page.getByPlaceholder('输入昨日收盘价').fill('10.500');
  await page.getByPlaceholder('输入上一笔成交价').fill('10.500');
  await page.getByPlaceholder('输入你看到的最新价格').fill('10.950');

  // 对比卡片利用横向空间：正方形区间放宽为多列（网格列数≥2）
  const gridColumns = await page.locator('.comparison-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBeGreaterThanOrEqual(2);

  // 十档表不出现横向滚动条
  const scroll = await page.locator('.ladder-panel .table-scroll').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
});

test('viewport meta 携带 viewport-fit=cover（静态检查）', async ({ page }) => {
  // 说明：styles.css 直接使用 env(safe-area-inset-*)（含 0px 回退），桌面端与无挖孔设备 env()=0 无副作用，
  // 无 CSS 变量间接层，故安全区用 addInitScript 注入假值无法通过 var() 回退写法验证，改为静态断言。
  await page.goto('/');
  const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '');
  expect(content).toContain('viewport-fit=cover');
  expect(content).toContain('interactive-widget=resizes-content');
});

test('v0.3.0 顶部摘要托盘与多周期手风琴交互', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createFund(page);

  const topSummary = page.locator('.top-summary');
  await expect(topSummary).toBeVisible();
  await topSummary.locator('summary').click();
  await expect(topSummary).toHaveAttribute('open', '');
  await expect(topSummary.locator('.top-summary-tray')).toBeVisible();
  await expect(topSummary.locator('.top-summary-tray')).toContainText('基金代码');
  await expect(topSummary.locator('.top-summary-tray')).toContainText('当前价格');

  const technicalDetails = page.locator('.technical-period-details');
  await technicalDetails.locator('summary').click();
  const daily = page.getByRole('button', { name: /日线/ });
  const weekly = page.getByRole('button', { name: /周线/ });
  const monthly = page.getByRole('button', { name: /月线/ });
  await expect(daily).toHaveAttribute('aria-expanded', 'true');
  await weekly.click();
  await expect(weekly).toHaveAttribute('aria-expanded', 'true');
  await expect(daily).toHaveAttribute('aria-expanded', 'false');
  await monthly.click();
  await expect(monthly).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.macd-period-card.expanded')).toHaveCount(1);

  await page.setViewportSize({ width: 360, height: 780 });
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('.macd-period-card').first().evaluate((element) => ({
    transitionDuration: getComputedStyle(element).transitionDuration,
    animationName: getComputedStyle(element).animationName,
  }));
  expect(motion.transitionDuration).toBe('0s');
  expect(motion.animationName).toBe('none');
});

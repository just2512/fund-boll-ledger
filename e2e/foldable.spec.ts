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
  }
});

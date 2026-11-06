import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const here = new URL('./', import.meta.url);
const screenshots = fileURLToPath(new URL('screenshots/', here));
await build({ entryPoints: [fileURLToPath(new URL('harness.js', here))], bundle: true, format: 'iife', outfile: fileURLToPath(new URL('harness.bundle.js', here)), define: { 'process.env.NODE_ENV': '"production"' } });
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const errors = [];
const results = [];
const pages = [];
const fixedTime = new Date('2026-11-06T15:00:00Z');
const packageNames = ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '@deepseek-ai/dsh-mcp-client'];
async function scenario(options = {}, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  pages.push(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: fixedTime });
  const url = new URL('harness.html', here);
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value);
  await page.goto(url.href);
  await page.clock.pauseAt(new Date(fixedTime.getTime() + 1000));
  await expect(page.getByRole('switch')).toBeVisible();
  return page;
}
const tick = (page, ms = 3300) => page.clock.runFor(ms);
const stats = page => page.evaluate(() => ({ calls: window.fixture.calls, events: window.fixture.events, installs: window.fixture.installs, enables: window.fixture.enables, healthRuns: window.fixture.healthRuns, state: window.fixture.state, getCount: window.fixture.getCount, maxActiveRequests: window.fixture.maxActiveRequests, abortedRequests: window.fixture.abortedRequests }));
async function pending(page) {
  await page.getByRole('switch').click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch')).toBeDisabled();
  await tick(page);
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function approve(page, label = '安装并启用') {
  await page.getByRole('button', { name: label, exact: true }).click();
  await tick(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function test(name, run) {
  await run();
  results.push(name);
  console.log('PASS: ' + name);
}
try {
  await test('existing controls and disable confirmation remain available', async () => {
    const page = await scenario({ scenario: 'running' });
    await expect(page.getByRole('heading', { name: '电脑操作能力', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '检查兼容组件', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'DSH 匹配版本', exact: true })).toBeVisible();
    await page.screenshot({ path: screenshots + '/desktop.png', fullPage: true });
    await page.getByRole('button', { name: '运行自检', exact: true }).click();
    await tick(page);
    await expect(page.getByText('screen_capture_capability', { exact: true })).toBeVisible();
    await page.getByRole('switch').click();
    await expect(page.getByRole('dialog')).toContainText('停用会影响当前配置下的所有会话');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).first().click();
    assert.equal((await stats(page)).calls.filter(item => item.action === 'setEnabled').length, 0);
    await page.getByRole('switch').click();
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await tick(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
  await test('ready switch activation skips installation and confirmation', async () => {
    const page = await scenario({ scenario: 'ready' });
    await page.getByRole('switch').click();
    await expect(page.getByRole('switch')).toBeDisabled();
    await expect(page.getByText('正在检查本地组件', { exact: true })).toBeVisible();
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await tick(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const result = await stats(page);
    assert.deepEqual(result.calls, [{ action: 'activate' }]);
    assert.equal(result.installs, 0);
    assert.equal(result.enables, 1);
    assert.equal(result.healthRuns, 1);
    assert.deepEqual(result.events, ['checking', 'enabling', 'waiting', 'health']);
  });
  await test('missing components automatically request one approval then enable and check health', async () => {
    const page = await scenario({ scenario: 'missing' });
    await pending(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('0.2.2-rc.1');
    await expect(dialog).toContainText('当前配置下的所有会话');
    for (const name of packageNames) await expect(dialog).toContainText(name);
    let result = await stats(page);
    assert.equal(result.installs + result.enables + result.healthRuns, 0);
    const approval = result.state.operation.confirmation;
    await approve(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    result = await stats(page);
    assert.deepEqual(result.calls, [{ action: 'activate' }, { action: 'activate', installVersion: approval.version, approvalId: approval.approvalId }]);
    assert.equal(result.installs, 1);
    assert.equal(result.enables, 1);
    assert.equal(result.healthRuns, 1);
    assert.equal(result.state.health.overall, 'ok');
    assert.deepEqual(result.events, ['checking', 'installing', 'enabling', 'waiting', 'health']);
  });
  for (const method of ['button', 'close', 'escape']) await test('cancel via ' + method + ' never reopens or continues activation', async () => {
    const page = await scenario({ scenario: 'missing' });
    await pending(page);
    if (method === 'button') await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).first().click();
    if (method === 'close') await page.locator('[data-dialog-close]').click();
    if (method === 'escape') await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await tick(page, 7000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const result = await stats(page);
    assert.deepEqual(result.calls, [{ action: 'activate' }]);
    assert.equal(result.installs + result.enables + result.healthRuns, 0);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    if (method === 'button') {
      await page.getByRole('switch').click();
      await tick(page);
      await expect(page.getByRole('dialog')).toBeVisible();
      assert.equal((await stats(page)).calls.length, 2);
    }
  });
  await test('foreign activation approval is never opened by polling', async () => {
    const page = await scenario({ scenario: 'missing' });
    await page.evaluate(() => { window.fixture.state.operation = { id: 'foreign', kind: 'activate', status: 'needs-confirmation', confirmation: { approvalId: 'foreign-approval', version: '0.2.2-rc.1', packages: ['foreign-package'] } }; });
    await tick(page, 7000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal((await stats(page)).calls.length, 0);
  });
  await test('installation failure leaves the switch off without health success', async () => {
    const page = await scenario({ scenario: 'missing', outcome: 'install-failure' });
    await pending(page);
    await approve(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    const result = await stats(page);
    assert.equal(result.state.operation.status, 'failed');
    assert.equal(result.state.health, null);
    assert.equal(result.enables + result.healthRuns, 0);
    await expect(page.locator('[data-operation-message]')).toContainText('remains disabled');
  });
  await test('restart requirement remains explicit and is not presented as enabled', async () => {
    const page = await scenario({ scenario: 'missing', outcome: 'restart' });
    await pending(page);
    await approve(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('需要重启 DSH', { exact: true }).first()).toBeVisible();
    assert.equal((await stats(page)).state.operation.status, 'restart-required');
  });
  for (const outcome of ['warning', 'health-unavailable']) await test('health ' + outcome + ' retains truthful enabled and diagnostic states', async () => {
    const page = await scenario({ scenario: 'ready', outcome });
    await page.getByRole('switch').click();
    await tick(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('需关注', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(outcome === 'warning' ? '部分异常' : '自检不可用', { exact: true })).toBeVisible();
    const result = await stats(page);
    assert.equal(result.state.operation.status, 'warning');
    assert.equal(result.state.running, true);
    assert.notEqual(result.state.health.overall, 'ok');
  });
  await test('separate component installation still preserves disabled configuration', async () => {
    const page = await scenario({ scenario: 'missing' });
    await page.getByRole('button', { name: '检查兼容组件', exact: true }).click();
    await tick(page);
    await page.getByRole('button', { name: '安装匹配版本', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('将组件对齐到当前 DSH 版本');
    await page.getByRole('button', { name: '确认安装', exact: true }).click();
    await tick(page);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    assert.deepEqual((await stats(page)).calls.map(item => item.action), ['checkUpdates', 'update']);
  });
  await test('stale responses lock mutations until recovery', async () => {
    const page = await scenario({ scenario: 'ready' });
    await page.evaluate(() => { window.fixture.failure = true; });
    await tick(page);
    await expect(page.getByRole('alert')).toContainText('保留上次读取的状态');
    await expect(page.getByRole('switch')).toBeDisabled();
    await page.evaluate(() => { window.fixture.failure = false; });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('switch')).toBeEnabled();
  });
  await test('hidden document and hidden panel do not poll', async () => {
    const page = await scenario({ scenario: 'ready' });
    let count = (await stats(page)).getCount;
    await page.evaluate(() => window.fixture.setVisibility('hidden'));
    await tick(page, 7000);
    assert.equal((await stats(page)).getCount, count);
    await page.evaluate(() => window.fixture.setVisibility('visible'));
    await expect.poll(async () => (await stats(page)).getCount).toBe(count + 1);
    count++;
    await page.evaluate(() => window.fixture.setPanelVisible(false));
    await tick(page, 7000);
    assert.equal((await stats(page)).getCount, count);
    await page.evaluate(() => { window.fixture.setPanelVisible(true); window.dispatchEvent(new Event('focus')); });
    await expect.poll(async () => (await stats(page)).getCount).toBe(count + 1);
  });
  await test('polls never overlap and unmount aborts pending requests and attempt ownership', async () => {
    const page = await scenario({ scenario: 'missing' });
    await pending(page);
    await page.evaluate(() => window.fixture.unmount());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => { window.fixture.delayMs = 5000; window.fixture.mount(); });
    await expect.poll(async () => page.evaluate(() => window.fixture.activeRequests)).toBe(1);
    await page.evaluate(() => { for (let index = 0; index < 8; index++) window.dispatchEvent(new Event('focus')); });
    await tick(page, 4000);
    assert.equal((await stats(page)).maxActiveRequests, 1);
    await page.evaluate(() => window.fixture.unmount());
    await expect.poll(async () => (await stats(page)).abortedRequests).toBe(1);
    const count = (await stats(page)).getCount;
    await tick(page, 7000);
    assert.equal((await stats(page)).getCount, count);
    await page.evaluate(() => { window.fixture.delayMs = 0; window.fixture.mount(); });
    await expect(page.getByRole('switch')).toBeVisible();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  for (const language of ['zh', 'en']) for (const width of [390, 320]) await test('activation modal fits ' + language + ' at ' + width + 'px', async () => {
    const page = await scenario({ scenario: 'missing', locale: language }, width);
    await pending(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(packageNames[1]);
    await expect(dialog).toContainText('0.2.2-rc.1');
    if (language === 'en') await expect(dialog).toContainText('every session in the current profile');
    const geometry = await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, overflowing: element.scrollWidth > element.clientWidth }; });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport, JSON.stringify(geometry));
    assert.equal(geometry.overflowing, false);
    const outside = await dialog.locator('button').evaluateAll(buttons => buttons.filter(button => { const rect = button.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth; }).map(button => button.textContent));
    assert.deepEqual(outside, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: screenshots + '/activation-' + language + '-' + width + '.png', fullPage: true });
    await approve(page, language === 'en' ? 'Install and enable' : '安装并启用');
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ result: 'passed', scenarios: results.length, workflows: results, viewports: [1280, 390, 320], consoleErrors: errors }, null, 2));
} finally { await browser.close(); }

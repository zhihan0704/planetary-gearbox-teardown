import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const parts = ['input', 'planets', 'ring', 'output'];
const defaultPage = fileURLToPath(new URL('../dist/planetary-gearbox.html', import.meta.url));
const shotFolder = fileURLToPath(new URL('../qa/', import.meta.url));
const suppliedPath = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const pagePath = suppliedPath ? resolve(suppliedPath) : defaultPage;
const saveShots = process.argv.includes('--shots');
const skipIdle = process.argv.includes('--skip-idle');
const animationTimeout = 12_000;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  channel: !process.env.CHROMIUM && !existsSync(chromium.executablePath()) ? 'chrome' : undefined,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const errors = [];
const externalRequests = new Set();

async function openPage(viewport, hasTouch = false) {
  const context = await browser.newContext({ viewport, hasTouch, offline: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) externalRequests.add(request.url());
  });
  await page.goto(pathToFileURL(pagePath).href);
  await page.waitForFunction(() => typeof window.getTeardownState === 'function');
  return page;
}

const state = page => page.evaluate(() => window.getTeardownState());
const action = (page, id) => page.locator(`[data-action="${id}"]`);
const partButton = (page, id) => page.locator(`[data-part="${id}"]`);

async function assertFit(page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(layout.scrollWidth <= layout.viewportWidth + 1, `Horizontal overflow at ${layout.viewportWidth}px`);
  const canvas = await page.locator('canvas#view').boundingBox();
  assert.ok(canvas && canvas.width > 100 && canvas.height > 100, '3D viewport must be visible');
  assert.ok(await page.locator('#view-error').isHidden(), 'WebGL viewport must initialize');
}

async function shot(page, filename) {
  if (!saveShots) return;
  await mkdir(shotFolder, { recursive: true });
  await page.screenshot({ path: resolve(shotFolder, `live-${filename}.png`), fullPage: true });
}

async function selectPart(page, id, hasTouch = false) {
  if (hasTouch) await partButton(page, id).tap();
  else await partButton(page, id).click();
  await page.waitForFunction(part => {
    const current = window.getTeardownState();
    return current.mode === 'manual' && current.part === part && current.opens[part] >= 0.95;
  }, id, { timeout: animationTimeout });
  assert.equal(await partButton(page, id).getAttribute('aria-pressed'), 'true');
  return (await page.locator('#part-title').innerText()).trim();
}

try {
  const html = await stat(pagePath);
  assert.ok(html.size < 1_000_000, `Standalone HTML is ${html.size} bytes`);
  const desktop = await openPage({ width: 1600, height: 900 });
  assert.equal((await state(desktop)).mode, 'auto');
  assert.match(await desktop.locator('#mode').innerText(), /AUTO TOUR/i);
  await assertFit(desktop);
  await shot(desktop, 'desktop');
  await desktop.waitForFunction(() => {
    const current = window.getTeardownState();
    if (current.mode !== 'auto' || current.part !== 'input' || current.opens.input < 0.95) return false;
    document.querySelector('[data-part="input"]').click();
    return true;
  }, undefined, { timeout: 34_000 });
  await desktop.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const takeover = await state(desktop);
  assert.equal(takeover.mode, 'manual');
  assert.equal(takeover.part, 'input', 'Selecting the active tour component must keep it open in manual mode');
  await action(desktop, 'reset').click();
  await desktop.waitForFunction(() => {
    const current = window.getTeardownState();
    return current.mode === 'manual' && current.part === 'assembly' && current.opens.input <= 0.05;
  }, undefined, { timeout: animationTimeout });

  const titles = new Set();
  for (const id of parts) {
    const title = await selectPart(desktop, id);
    assert.ok(title, `Part ${id} must have a heading`);
    titles.add(title);
    await shot(desktop, id);
  }
  assert.equal(titles.size, parts.length, 'Each part must show different panel content');
  assert.match(await desktop.locator('#mode').innerText(), /MANUAL/i);
  assert.ok((await desktop.locator('#rpm').innerText()).trim(), 'Input speed must be visible');
  assert.ok((await desktop.locator('#output-rpm').innerText()).trim(), 'Output speed must be visible');

  await action(desktop, 'explode').click();
  await desktop.waitForFunction(ids => ids.every(id => window.getTeardownState().opens[id] >= 0.95), parts, { timeout: animationTimeout });
  await shot(desktop, 'exploded');
  await action(desktop, 'reset').click();
  await desktop.waitForFunction(ids => ids.every(id => window.getTeardownState().opens[id] <= 0.05), parts, { timeout: animationTimeout });

  const driveButton = action(desktop, 'drive');
  assert.equal(await driveButton.getAttribute('aria-pressed'), 'false', 'Drive starts running');
  const running = (await state(desktop)).drive;
  assert.ok(running.rpm > 0, 'A running drive must show positive input speed');
  assert.ok(Math.abs(running.rpm / running.outputRpm - 4) < 1e-6, 'Input/output speeds must follow the 4:1 ratio');
  await driveButton.focus();
  await desktop.keyboard.press('Space');
  await desktop.waitForFunction(() => {
    const drive = window.getTeardownState().drive;
    return drive.rpm === 0 && drive.outputRpm === 0;
  });
  assert.equal(await driveButton.getAttribute('aria-pressed'), 'true', 'Drive must pause with the keyboard');
  await desktop.keyboard.press('Space');
  await desktop.waitForFunction(() => window.getTeardownState().drive.rpm > 0);
  assert.equal(await driveButton.getAttribute('aria-pressed'), 'false');

  const view = await desktop.locator('canvas#view').boundingBox();
  const x = view.x + view.width * 0.5;
  const y = view.y + view.height * 0.5;
  const priorCamera = (await state(desktop)).camera;
  await desktop.mouse.move(x, y);
  await desktop.mouse.down();
  await desktop.mouse.move(x + 110, y + 35, { steps: 12 });
  await desktop.mouse.up();
  await desktop.waitForFunction(camera => {
    const next = window.getTeardownState().camera;
    return Math.abs(next.azimuth - camera.azimuth) > 0.05 || Math.abs(next.elevation - camera.elevation) > 0.05;
  }, priorCamera, { timeout: animationTimeout });
  const priorZoom = (await state(desktop)).camera.zoom;
  await desktop.mouse.move(x, y);
  await desktop.mouse.wheel(0, -120);
  await desktop.waitForFunction(zoom => window.getTeardownState().camera.zoom > zoom + 0.05, priorZoom, { timeout: animationTimeout });

  await action(desktop, 'tour').click();
  await desktop.waitForFunction(() => window.getTeardownState().mode === 'auto', undefined, { timeout: animationTimeout });
  await desktop.mouse.click(x, y);
  await desktop.waitForFunction(() => window.getTeardownState().mode === 'manual', undefined, { timeout: animationTimeout });

  if (!skipIdle) {
    await desktop.waitForFunction(() => window.getTeardownState().mode === 'auto', undefined, { timeout: 38_000 });
    assert.match(await desktop.locator('#mode').innerText(), /AUTO TOUR/i);
  }
  await desktop.context().close();

  const mobile = await openPage({ width: 390, height: 844 }, true);
  await assertFit(mobile);
  await selectPart(mobile, 'ring', true);
  await assertFit(mobile);
  await shot(mobile, 'mobile');
  await action(mobile, 'explode').tap();
  await mobile.waitForFunction(ids => ids.every(id => window.getTeardownState().opens[id] >= 0.95), parts, { timeout: animationTimeout });
  await assertFit(mobile);
  await shot(mobile, 'mobile-exploded');
  await mobile.context().close();

  assert.deepEqual([...externalRequests], [], 'Standalone page attempted external network requests');
  assert.deepEqual(errors, [], 'Browser reported errors');
  const idleStatus = skipIdle ? '' : ' and idle handback';
  console.log(`Passed offline load, four part controls, explosion/reset, keyboard drive toggle, orbit and zoom, auto tour takeover${idleStatus}, and mobile layout and touch controls. HTML is ${html.size.toLocaleString('en-US')} bytes.`);
} finally {
  await browser.close();
}

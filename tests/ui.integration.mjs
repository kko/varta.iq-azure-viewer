import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CloudService } from '../cloud/api/src/service.mjs';
import { AuthService, tokenFrom } from '../cloud/api/src/auth.mjs';
import { handleAuth } from '../cloud/api/src/functions.mjs';
import { MemoryStore, packet } from './helpers.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

test('browser: cloud year/custom ranges, language switching and mobile layout; collector without login', { timeout: 90000 }, async () => {
  const store = new MemoryStore(), cloud = new CloudService(store, 'varta-home'), auth = new AuthService(store);
  await cloud.ingest(packet());
  let mode = 'cloud';
  let config = { gatewayIp: '192.168.4.119', uploadUrl: '', collectorId: 'varta-home', enabled: false, hasGatewayApiKey: true, hasUploadKey: false };
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5);
        if (mode === 'cloud') {
          const request = { method: req.method, url: `http://${req.headers.host}${req.url}`, headers: new Headers(req.headers), params: { action: name.slice(5) }, text: async () => { let body = ''; for await (const chunk of req) body += chunk; return body; } };
          if (name.startsWith('auth/')) {
            const result = await handleAuth(request, { error: console.error }, auth, { VARTA_SETUP_KEY: 'browser-test-setup' });
            res.writeHead(result.status, { ...result.headers, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(result.jsonBody));
          }
          try { await auth.authenticate(tokenFrom(request)); } catch (error) { return json(error.status, { error: error.message }); }
          return json(200, name === 'history' ? await cloud.history(url.searchParams) : name === 'status' ? await cloud.status() : await cloud.latest(name));
        }
        let input = ''; for await (const chunk of req) input += chunk;
        if (name === 'settings') { if (req.method === 'PUT') { const value = JSON.parse(input); config = { ...config, ...value, hasUploadKey: Boolean(value.uploadKey) }; delete config.uploadKey; } return json(200, config); }
        if (name.startsWith('test/')) return json(200, { ok: true });
        if (name === 'status') return json(200, { point: { stale: false }, devices: { stale: false }, upload: { enabled: true, stale: false }, buffer: { count: 4, oldestAt: new Date().toISOString(), dropped: 0 }, errors: [{ at: new Date().toISOString(), source: 'azure', message: 'Beispielfehler' }] });
        return json(404, {});
      }
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^[a-z0-9.-]+$/.test(filename)) return json(404, {});
      const file = mode === 'cloud' ? new URL(`../cloud/site/${filename}`, import.meta.url) : filename === 'style.css' ? new URL('../public/style.css', import.meta.url) : new URL(`../collector/public/${filename}`, import.meta.url);
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[filename.slice(filename.lastIndexOf('.'))] || 'text/plain' }); res.end(content);
    } catch (error) { json(500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.waitForURL('**/account.html');
    await page.locator('#setupPanel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#setupForm button').isDisabled(), true);
    await page.goto(base + '/account.html#setup=browser-test-setup');
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/admin-setup.png', import.meta.url)), fullPage: true });
    await page.fill('#setupForm [name=username]', 'testadmin'); await page.fill('#setupForm [name=email]', 'admin@example.test');
    await page.fill('#setupForm [name=password]', 'Ein eigenes Adminpasswort!'); await page.fill('#setupForm [name=confirmation]', 'Ein eigenes Adminpasswort!');
    await page.click('#setupForm button'); await page.waitForURL(base + '/');
    try { await page.waitForFunction(() => document.getElementById('pv').textContent.includes('200'), null, { timeout: 10000 }); }
    catch (error) { console.log('Browser errors:', errors); console.log((await page.locator('body').innerText()).slice(0, 1800)); throw error; }
    await page.selectOption('#historyRange', 'year'); await page.waitForFunction(() => document.getElementById('historyMeta').textContent.includes('1 '));
    await page.selectOption('#historyRange', 'custom'); assert.equal(await page.locator('#dateRange').isVisible(), true);
    const now = Date.now(); await page.fill('#historyFrom', new Date(now - 86400000).toISOString().slice(0,16)); await page.fill('#historyTo', new Date(now).toISOString().slice(0,16)); await page.click('#applyRange');
    await page.selectOption('#language', 'en'); assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.selectOption('#historyRange', '1'); await page.waitForTimeout(100);
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/cloud-desktop.png', import.meta.url)), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(base + '/account.html'); await page.locator('#usersPanel').waitFor({ state: 'visible' });
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/user-management-mobile.png', import.meta.url)), fullPage: true });
    await page.fill('#createForm [name=username]', 'testviewer'); await page.fill('#createForm [name=email]', 'viewer@example.test'); await page.fill('#createForm [name=password]', 'Ein temporaeres Passwort!');
    await page.click('#createForm button'); await page.waitForFunction(() => document.getElementById('message').textContent.includes('angelegt'));
    await page.click('#logout'); await page.locator('#loginPanel').waitFor({ state: 'visible' });
    await page.fill('#loginForm [name=email]', 'testviewer'); await page.fill('#loginForm [name=password]', 'Ein temporaeres Passwort!'); await page.click('#loginForm button');
    await page.locator('#requiredChange').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#usersPanel').isVisible(), false); assert.equal(await page.locator('#dashboard').isVisible(), false);
    assert.equal(await page.evaluate(async () => (await fetch('/api/point')).status), 403);
    await page.fill('#passwordForm [name=currentPassword]', 'Ein temporaeres Passwort!'); await page.fill('#passwordForm [name=password]', 'Mein eigenes sicheres Passwort!'); await page.fill('#passwordForm [name=confirmation]', 'Mein eigenes sicheres Passwort!');
    await page.click('#passwordForm button'); await page.waitForURL(base + '/'); await page.locator('#pv').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(async () => (await fetch('/api/auth/users')).status), 403);
    assert.equal((await context.request.post(base + '/api/auth/logout', { headers: { Origin: 'https://evil.example' }, data: {} })).status(), 403);
    mode = 'collector'; await page.goto(base); await page.locator('#admin').waitFor({ state: 'visible' }); assert.equal(await page.locator('#login').count(), 0);
    await page.fill('[name=uploadUrl]', 'https://example.azurestaticapps.net/api/ingest'); await page.fill('[name=uploadKey]', 'browser-test-key'); await page.check('[name=enabled]'); await page.click('#settings button[type=submit], #settings button:not([type])');
    await page.waitForFunction(() => document.getElementById('message').textContent.includes('gespeichert'));
    assert.equal(await page.locator('[name=uploadKey]').inputValue(), ''); assert.match(await page.locator('#buffer').textContent(), /4 Pakete/);
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/collector-mobile.png', import.meta.url)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

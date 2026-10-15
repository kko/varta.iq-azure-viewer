import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchGateway } from '../gateway-https.mjs';

async function openssl() {
  if (process.env.OPENSSL_BIN) return process.env.OPENSSL_BIN;
  if (process.platform === 'win32') { const candidate = 'C:/Program Files/Git/usr/bin/openssl.exe'; try { await access(candidate); return candidate; } catch {} }
  return 'openssl';
}
async function certificate(directory, name) {
  execFileSync(await openssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, `${name}.key`), '-out', join(directory, `${name}.crt`), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'pipe' });
}
test('gateway HTTPS pins the certificate and forwards the API key; changed certificates fail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'varta-tls-')); let server;
  try {
    await certificate(dir, 'gateway'); await certificate(dir, 'different');
    await copyFile(join(dir, 'gateway.crt'), join(dir, 'gateway-127.0.0.1.pem'));
    server = https.createServer({ key: await readFile(join(dir, 'gateway.key')), cert: await readFile(join(dir, 'gateway.crt')) }, (req, res) => { res.writeHead(req.headers['x-api-key'] === 'local-secret' ? 200 : 401, { 'Content-Type': 'application/json' }); res.end('{}'); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `https://127.0.0.1:${server.address().port}/v2/point`, certificates = pathToFileURL(dir + sep);
    assert.equal((await fetchGateway(base, certificates, 'local-secret')).status, 200);
    assert.equal((await fetchGateway(base, certificates, 'wrong')).status, 401);
    await copyFile(join(dir, 'different.crt'), join(dir, 'gateway-127.0.0.1.pem'));
    await assert.rejects(fetchGateway(base, certificates, 'local-secret'));
    await assert.rejects(fetchGateway(base.replace('https:', 'http:'), certificates), /HTTPS/);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
for (const secure of [false, true]) test(`${secure ? 'HTTPS' : 'HTTP'} local admin opens without login, enforces origin and keeps secrets private`, { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'varta-admin-')); let child;
  try {
    if (secure) await certificate(dir, 'tls');
    const probe = https.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const hostname = `127.0.0.1:${port}`, origin = `${secure ? 'https' : 'http'}://${hostname}`, cert = secure ? await readFile(join(dir, 'tls.crt')) : undefined;
    child = spawn(process.execPath, ['collector/server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, CONFIG_DIR: dir, DATA_DIR: join(dir, 'records'), PORT: String(port), HOST: '127.0.0.1', COLLECTOR_HTTPS: secure ? 'true' : '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => reject(new Error(`Collector exited ${code}: ${stderr}`))); child.stdout.on('data', chunk => { if (chunk.toString().includes('VARTA Collector:')) resolve(); }); });
    const request = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
      const req = (secure ? https : http).request(`${origin}${path}`, { method, ca: cert, servername: 'localhost', headers: { ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...headers } }, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) })); });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
    assert.equal((await request('/')).status, 200); assert.equal((await request('/api/settings')).status, 200);
    assert.equal((await request('/healthz', { headers: { Host: `evil.test:${port}` } })).status, 403);
    assert.equal((await request('/api/login', { method: 'POST', body: {} })).status, 404);
    const headers = {};
    const settings = { gatewayIp: '127.0.0.1', gatewayApiKey: 'do-not-return', uploadUrl: '', enabled: false };
    assert.equal((await request('/api/settings', { method: 'PUT', body: settings, headers: { Origin: '' } })).status, 403);
    assert.equal((await request('/api/settings', { method: 'PUT', body: settings, headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
    const saved = await request('/api/settings', { method: 'PUT', body: settings, headers }); assert.equal(saved.status, 200); assert.ok(!saved.text.includes('do-not-return')); assert.equal(saved.json().hasGatewayApiKey, true);
    assert.equal(saved.headers['set-cookie'], undefined);
    assert.equal(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).gatewayApiKey, 'do-not-return');
    assert.equal((await request('/api/status', { headers })).status, 200);
    assert.equal((await request('/api/settings')).status, 200);
  } finally { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } await rm(dir, { recursive: true, force: true }); }
});

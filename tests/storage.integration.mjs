import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AzureStore } from '../cloud/api/src/storage.mjs';
import { CloudService } from '../cloud/api/src/service.mjs';
import { AuthService } from '../cloud/api/src/auth.mjs';
import { packet } from './helpers.mjs';
import { dayOf, tableName } from '../shared/model.mjs';

test('real Azure SDK + Azurite: transactions, ETags, queries and concurrent replay', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'varta-azurite-')); let child;
  try {
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const emulator = process.env.AZURITE_TABLE_MAIN || fileURLToPath(new URL('../node_modules/azurite/dist/src/table/main.js', import.meta.url));
    child = spawn(process.execPath, [emulator, '--silent', '--skipApiVersionCheck', '--tableHost', '127.0.0.1', '--tablePort', String(port), '--location', directory, '--disableTelemetry'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '', output = ''; child.stderr.on('data', chunk => { errors += chunk; });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Azurite startup timeout: ${output} ${errors}`)), 60000); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Azurite exited ${code}: ${errors}`)); }); child.stdout.on('data', chunk => { output += chunk; if (output.includes('successfully started')) { clearTimeout(timer); resolve(); } }); });
    console.log('Azurite ready; checking SDK storage');
    const connection = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`;
    const store = new AzureStore(connection, { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } }), service = new CloudService(store, 'varta-home');
    const now = Date.now(), packets = Array.from({ length: 6 }, (_, i) => packet(now - 100000 + i * 10000));
    await Promise.all(packets.map(p => service.ingest(p)));
    console.log('Concurrent ingest complete');
    await service.ingest(packets[0]);
    await service.ingest(packet(now, { point: packets[0].point }));
    const history = await service.history(new URLSearchParams({ hours: '1' }), now + 1);
    assert.equal(history.sampleCount, packets.length); assert.ok(history.points.every(point => point.values.pW === 200));
    const aggregates = await store.query(tableName(dayOf(now)), 'varta-home', 'a300:', 'a301:');
    assert.equal(aggregates.reduce((sum, row) => sum + JSON.parse(row.payload).sampleCount, 0), packets.length);
    const status = await service.status(); assert.equal(status.stale, false);
    const metadata = await store.get('VartaMeta', 'varta-home', 'status');
    await assert.rejects(store.transaction('VartaMeta', [['update', { partitionKey: 'varta-home', rowKey: 'status', payload: '{}', time: new Date().toISOString() }, 'Replace', { etag: 'W/"wrong"' }]]), error => error.statusCode === 412);
    assert.equal((await store.get('VartaMeta', 'varta-home', 'status')).etag, metadata.etag);
    const auth = new AuthService(store), key = 'integration-setup-only';
    const attempts = await Promise.allSettled([
      auth.setup({ username: 'admin', email: 'admin@example.test', password: 'Ein eigenes Testpasswort!', setupKey: key }, key),
      auth.setup({ username: 'other', email: 'other@example.test', password: 'Ein eigenes Testpasswort!', setupKey: key }, key)
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const admin = attempts.find(result => result.status === 'fulfilled').value;
    assert.equal((await auth.users(admin.token)).length, 1);
    await auth.manageUser(admin.token, { username: 'viewer', email: 'viewer@example.test', password: 'Ein temporaeres Passwort!' });
    const viewer = await auth.login({ email: 'viewer', password: 'Ein temporaeres Passwort!' });
    await assert.rejects(auth.authenticate(viewer.token), error => error.status === 403);
    const changed = await auth.changePassword(viewer.token, { currentPassword: 'Ein temporaeres Passwort!', password: 'Jetzt ein eigenes Passwort!' });
    assert.equal((await auth.authenticate(changed.token)).role, 'viewer');
    await auth.manageUser(admin.token, { email: 'viewer@example.test', disabled: true });
    await assert.rejects(auth.authenticate(changed.token), error => error.status === 401);
    console.log('Auth storage: concurrent setup, password change, ETags and session revocation verified');
  } finally { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } await rm(directory, { recursive: true, force: true }); }
});

// Local end-to-end soak: real collector/persistent spool + in-memory Azure adapter.
// This deliberately does not claim a hardware/Azure deployment acceptance.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../collector/engine.mjs';
import { Spool, ErrorLog } from '../collector/state.mjs';
import { CloudService } from '../cloud/api/src/service.mjs';
import { MemoryStore, packet } from '../tests/helpers.mjs';
const accelerated = process.argv.includes('--accelerated');
const interval = accelerated ? 0 : 10000, ticks = 180;
const dir = await mkdtemp(join(tmpdir(), 'varta-acceptance-'));
const store = new MemoryStore(), service = new CloudService(store, 'varta-home');
const config = { gatewayIp: '127.0.0.1', collectorId: 'varta-home', enabled: true };
let tick = 0, engine, spool, offline = false;
const startedAt = Date.now(), sampleStart = accelerated ? startedAt - ticks * 10000 : startedAt;
async function start() {
  spool = new Spool(join(dir, 'spool')); await spool.init(); const errors = new ErrorLog(join(dir, 'errors.json')); await errors.init();
  engine = new Collector({ config, spool, errors, gatewayFetch: async url => ({ ok: true, status: 200, json: async () => url.endsWith('point') ? packet(sampleStart + tick * 10000).point.data : packet().devices.data }), upload: async (_, packets) => { if (offline) throw new Error('Simulierter Internetausfall'); const accepted = []; for (const p of packets) accepted.push(await service.ingest(p)); return { accepted }; } });
}
try {
  await start();
  for (tick = 0; tick < ticks; tick++) {
    offline = tick >= 40 && tick < 70;
    if (tick === 60) await start(); // restart while offline, retaining the volume
    engine.retryAt = 0; await engine.poll();
    if (!offline) { while (spool.status().count) { engine.retryAt = 0; await engine.flush(); } }
    if (tick % 6 === 0) console.log(`${tick}/${ticks} · Puffer ${spool.status().count} · ${offline ? 'offline' : 'online'}`);
    if (interval) await new Promise(resolve => setTimeout(resolve, interval));
  }
  const history = await service.history(new URLSearchParams({ hours: '1' }), Date.now() + 1);
  assert.equal(history.sampleCount, ticks); assert.equal(spool.status().count, 0);
  console.log(JSON.stringify({ ok: true, mode: accelerated ? 'accelerated simulation' : '30-minute local soak', samples: history.sampleCount, elapsedSeconds: (Date.now() - startedAt) / 1000, hardwareAndAzureVerified: false }));
} finally { await rm(dir, { recursive: true, force: true }); }

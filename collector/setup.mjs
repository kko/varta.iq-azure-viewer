import { mkdir, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = process.env.CONFIG_DIR || './collector-config';
await mkdir(directory, { recursive: true, mode: 0o700 });
const exists = async name => { try { await access(join(directory, name)); return true; } catch { return false; } };
for (const name of ['admin.json', 'bootstrap.txt']) if (await exists(name)) await unlink(join(directory, name));
console.log('Lokaler Collector eingerichtet. Die Oberfläche benötigt keine Anmeldung.');
if (process.env.COLLECTOR_HTTPS === 'true' && (!(await exists('tls.key')) || !(await exists('tls.crt')))) {
  const hosts = (process.env.COLLECTOR_TLS_HOSTS || 'localhost,127.0.0.1').split(',').map(s => s.trim());
  if (hosts.some(h => !/^[a-zA-Z0-9._-]+$/.test(h))) throw new Error('Ungültiger TLS-Hostname.');
  const alt = hosts.map(h => `${/^\d+\.\d+\.\d+\.\d+$/.test(h) ? 'IP' : 'DNS'}:${h}`).join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', join(directory, 'tls.key'), '-out', join(directory, 'tls.crt'), '-subj', '/CN=VARTA Collector', '-addext', `subjectAltName=${alt}`], { stdio: 'pipe' });
  const { chmod } = await import('node:fs/promises');
  await chmod(join(directory, 'tls.key'), 0o600);
  console.log('Lokales HTTPS-Zertifikat erstellt. Zertifikat auf zugreifenden Geräten vertrauen.');
}

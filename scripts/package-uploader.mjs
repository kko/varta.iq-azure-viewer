import { mkdir, cp, copyFile, readFile, writeFile, readdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || join(root, 'artifacts'));
await mkdir(output, { recursive: true });
// A fresh directory prevents stale files from earlier packages entering the archive.
const staging = join(output, `uploader-build-${Date.now()}`);
await mkdir(staging);
await cp(join(root, 'collector'), join(staging, 'collector'), { recursive: true, filter: source => !/[\\/](node_modules|data|config|collector-config|collector-data)([\\/]|$)/.test(source) });
await mkdir(join(staging, 'shared')); await mkdir(join(staging, 'public')); await mkdir(join(staging, 'certificates'));
for (const file of ['gateway-https.mjs', 'settings.mjs', 'LICENSE']) await copyFile(join(root, file), join(staging, file));
await copyFile(join(root, 'shared/model.mjs'), join(staging, 'shared/model.mjs'));
await copyFile(join(root, 'public/style.css'), join(staging, 'public/style.css'));
for (const name of await readdir(join(root, 'certificates'))) {
  if (!/^gateway-[0-9.]+\.pem$/.test(name)) continue;
  const pem = await readFile(join(root, 'certificates', name), 'utf8');
  if (!pem.includes('BEGIN CERTIFICATE') || pem.includes('PRIVATE KEY')) throw new Error('Nur öffentliche Gateway-Zertifikate dürfen ins Image.');
  await writeFile(join(staging, 'certificates', name), pem);
}
const compose = await readFile(join(root, 'compose.collector.yaml'), 'utf8');
await writeFile(join(staging, 'compose.yaml'), 'name: varta-uploader\n' + compose);
await writeFile(join(staging, '.env.example'), `COLLECTOR_BIND_ADDRESS=0.0.0.0\nCOLLECTOR_ALLOWED_HOSTS=localhost:8788,127.0.0.1:8788\n# Für andere Geräte die IP/den Namen des Docker-Hosts samt :8788 ergänzen.\n`);
await writeFile(join(staging, 'README.md'), `# VARTA Azure Uploader – eigener Docker-Container

Voraussetzung: Docker Engine mit Linux-Containern und Compose v2. Das Paket enthält nur den lokalen Uploader mit Verwaltungsoberfläche. Azure bleibt unverändert eingerichtet. PC/x64, Raspberry Pi ARM64 und ARMv7 werden vom Basisimage unterstützt.

## Start

1. Archiv in einen eigenen Ordner entpacken und dort ein Terminal öffnen.
2. Optional .env.example nach .env kopieren. Für Heimnetzzugriff COLLECTOR_ALLOWED_HOSTS um die IP/den Namen des Docker-Hosts mit Port :8788 ergänzen.
3. Image bauen und starten:

\`\`\`sh
docker compose build
docker compose up -d
docker compose ps
\`\`\`

Oberfläche: http://localhost:8788, ohne Passwort. Dort Gateway-IP, VARTA-Key, Azure-Upload-Adresse, Collector-ID und Upload-Schlüssel speichern, beide Verbindungen testen und den Upload aktivieren. Es werden alle zehn Sekunden Daten gelesen und hochgeladen; der Puffer hält maximal 30 Tage. Daten und Einstellungen liegen in eigenen persistenten Docker-Volumes im Compose-Projekt varta-uploader.

## Vorhandene Einstellungen übernehmen

Die bisherige Datei collector-config/settings.json enthält auch die bereits gespeicherten Azure-Einstellungen. Sie ist absichtlich nicht in diesem Paket oder im Image enthalten. Auf dem Docker-Host vor dem ersten Start importieren (Pfade anpassen):

\`\`\`sh
docker compose stop
docker compose run --rm --no-deps -T collector node collector/import-settings.mjs < /pfad/settings.json
docker compose up -d
\`\`\`

In PowerShell:

\`\`\`powershell
Get-Content -Raw 'C:/Pfad/collector-config/settings.json' | docker compose run --rm --no-deps -T collector node collector/import-settings.mjs
docker compose up -d
\`\`\`

Der Import übernimmt VARTA- und Azure-Einstellungen einschließlich Upload-Schalter, ohne Schlüssel auszugeben. Einen vorhandenen Puffer vor einem Zielwechsel vollständig übertragen. Der bisherige lokale Prozess belegt denselben Port: Auf demselben Rechner erst nach leerem Puffer beenden, dann den Container starten. Für einen anderen Docker-Host die Konfiguration separat übertragen. Lokale, noch nicht hochgeladene Pufferdateien werden durch den Einstellungsimport nicht kopiert.

## Betrieb

\`\`\`sh
docker compose logs -f
docker compose down
\`\`\`

Die Volumes bleiben bei down erhalten; down -v löscht Einstellungen und Puffer. Dieses Archiv ist ein Docker-Baupaket, kein vorgebautes Image. Die Azure-Website verwendet eigene Benutzerkonten; der Collector-Upload ist unabhängig davon durch seinen Schlüssel geschützt.
`);
// Normalize copied Windows read-only attributes before archiving for Linux hosts.
async function permissions(directory) {
  await chmod(directory, 0o755);
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await permissions(path); else await chmod(path, 0o644);
  }
}
await permissions(staging);
const archive = join(output, 'varta-uploader-docker.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', staging, '.']);
console.log(JSON.stringify({ archive, directory: staging }));

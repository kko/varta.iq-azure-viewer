import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, validateConfig, saveConfig } from './config.mjs';
import { Spool } from './state.mjs';

export async function importSettings(input, configDirectory, dataDirectory) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('JSON-Objekt mit Collector-Einstellungen erwartet.');
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const file = join(configDirectory, 'settings.json');
  const previous = await loadConfig(file);
  const next = validateConfig(input, previous);
  const spool = new Spool(join(dataDirectory, 'spool')); await spool.init();
  if (spool.entries.size && (next.collectorId !== previous.collectorId || (previous.uploadUrl && next.uploadUrl !== previous.uploadUrl))) throw new Error('Vor einem Zielwechsel den vorhandenen Puffer vollständig übertragen.');
  await saveConfig(file, next, previous);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    let body = '';
    for await (const chunk of process.stdin) { body += chunk; if (body.length > 16384) throw new Error('Importdatei ist zu groß.'); }
    await importSettings(JSON.parse(body.replace(/^\uFEFF/, '')), resolve(process.env.CONFIG_DIR || './collector-config'), resolve(process.env.DATA_DIR || './collector-data'));
    console.log('VARTA- und Azure-Einstellungen importiert. Schlüssel werden nicht ausgegeben.');
  } catch (error) { console.error(error instanceof SyntaxError ? 'Ungültige JSON-Importdatei.' : error.message); process.exitCode = 1; }
}

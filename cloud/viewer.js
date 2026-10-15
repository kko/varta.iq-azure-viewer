import { refreshHistory } from './history.js';
import { t, locale, message, forgetMessage, initTranslations } from './i18n.js';
const $ = id => document.getElementById(id);
const number = (value, unit = '') => Number.isFinite(value) ? `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value)}${unit ? ' ' + unit : ''}` : '—';
const date = value => value ? new Date(value).toLocaleString(locale(), { timeZone: 'Europe/Berlin' }) : '—';
const hints = { pW: 'PV-Leistung · W', cW: 'Verbrauchsleistung · W', soc: 'Batterie-Ladezustand · %', bcW: 'Batterie-Ladeleistung · W', bdW: 'Batterie-Entladeleistung · W', t: 'Zeitstempel des Gateways', fw: 'Firmware-Version', v: 'Datenformat-Version', iv: 'Messintervall', devices: 'Messwerte je Gerät; Zuordnung über _id ↔ deviceId' };
let point = null, deviceList = null, busy = false, status = null;
const lastResults = {};
/* SHARED_RENDERERS */
async function read(name) {
  const response = await fetch(`/api/${name}`, { cache: 'no-store', signal: AbortSignal.timeout(40000) });
  if (response.status === 401 || response.status === 403) { location.replace('/account.html'); throw new Error('Anmeldung oder Passwortwechsel erforderlich.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function renderStatus() {
  if (!status) return;
  $('cloudStatus').textContent = `Letztes Paket: ${date(status.createdAt)} · Messwert: ${date(status.measurementAt)}${status.measurementStale ? ' · Messwert veraltet' : ''} · VARTA point: ${status.point?.error || (status.pointSuccessAt ? 'OK' : 'Warte')} · devices: ${status.devices?.error || (status.devicesSuccessAt ? 'OK' : 'Warte')}`;
  $('recording').textContent = status.stale ? 'Collector-Daten fehlen oder sind älter als 30 Sekunden.' : 'Collector überträgt aktuelle Pakete.';
  $('cleanupStatus').textContent = status.cleanup ? `Bereinigung: ${date(status.cleanup.at)} · ${status.cleanup.error || 'OK'}` : 'Bereinigung noch nicht ausgeführt.';
  if (status.cleanup && Date.now() - Date.parse(status.cleanup.at) > 36 * 3600000) $('cleanupStatus').textContent += ' · Bereinigung überfällig';
}
async function load(name) {
  const badge = $(name + 'Status');
  try {
    const result = await read(name); lastResults[name] = result;
    if (name === 'point') { point = result.data; renderPoint(point); } else deviceList = result.data;
    showResult(name, result);
    const stale = Date.now() - Date.parse(result.receivedAt) > 30000 || (name === 'point' && Date.now() - Date.parse(result.data.t) > 30000);
    badge.textContent = stale ? 'Gespeicherte Daten · veraltet' : 'Azure · aktuell'; badge.className = stale ? 'badge fail' : 'badge ok';
    return !stale;
  } catch (error) { badge.textContent = 'Daten nicht verfügbar'; badge.className = 'badge fail'; $(name + 'Meta').textContent = error.message; return false; }
}
async function refresh() {
  if (busy) return; busy = true; $('refresh').disabled = true;
  try {
    const results = await Promise.all([load('point'), load('devices'), refreshHistory(), read('status').then(value => { status = value; renderStatus(); }).catch(error => { $('cloudStatus').textContent = error.message; })]);
    renderDevices();
    $('status').textContent = results[0] && results[1] && status && !status.stale ? `Aktualisiert: ${date(Date.now())}` : 'Daten fehlen teilweise oder sind veraltet';
  } finally { busy = false; $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', refresh);
setInterval(() => { if ($('auto').checked && !document.hidden) refresh(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('auto').checked) refresh(); });
document.addEventListener('languagechange', () => { if (point) renderPoint(point); renderDevices(); for (const [name, result] of Object.entries(lastResults)) showResult(name, result); renderStatus(); });
initTranslations();
$('gatewayAddress').textContent = 'Azure / hochgeladene Daten';
refresh();

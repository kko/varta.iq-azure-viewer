import { t, locale, errorText, initTranslations } from './i18n.js';
const $ = id => document.getElementById(id);
const form = $('settings'); let refreshing = false, lastStatus, lastConfig, message;
const date = value => value ? new Date(value).toLocaleString(locale(), { timeZone: 'Europe/Berlin' }) : '—';
function showMessage(key, raw) { message = { key, raw }; renderMessage(); }
function renderMessage() { $('message').textContent = !message ? '' : message.key ? t(message.key) : errorText(message.raw); }
function keyHints() {
  if (!lastConfig) return;
  for (const [name, flag] of [['gatewayApiKey', 'hasGatewayApiKey'], ['uploadKey', 'hasUploadKey']]) form.elements[name].placeholder = t(lastConfig[flag] ? 'savedKey' : 'noKey');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function row(values) { const tr = document.createElement('tr'); for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr; }
function renderStatus() {
  const s = lastStatus; if (!s) return;
  $('statuses').replaceChildren(...['point', 'devices'].map(name => row([`VARTA / ${name}`, s[name].error ? t('error') : s[name].stale ? t('stale') : 'OK', `${t('attempt')}: ${date(s[name].attemptAt)}`, `${t('success')}: ${date(s[name].lastSuccessAt)}`])), row([t('azureUpload'), !s.upload.enabled ? t('disabled') : s.upload.error ? t('error') : s.upload.stale ? t('stale') : 'OK', `${t('attempt')}: ${date(s.upload.lastAttemptAt)}`, `${t('confirmed')}: ${date(s.upload.lastCurrentSuccessAt)}`]), row([t('measurement'), s.measurementStale ? t('missing') : t('current'), date(s.latestMeasurementAt), `${t('lastUpload')}: ${date(s.upload.lastSuccessAt)}`]));
  $('buffer').textContent = t('buffer', { count: s.buffer.count, oldest: date(s.buffer.oldestAt), dropped: s.buffer.dropped, retry: date(s.upload.retryAt) });
  $('errors').replaceChildren(...s.errors.map(error => row([date(error.at), errorText(error.source), errorText(error.message)])));
  if (!s.errors.length) $('errors').append(row(['—', '—', t('noErrors')]));
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    lastStatus = await api('status'); renderStatus();
  } catch (error) { showMessage(null, error.message); } finally { refreshing = false; }
}
async function load() {
  const config = lastConfig = await api('settings');
  for (const name of ['gatewayIp', 'uploadUrl', 'collectorId']) form.elements[name].value = config[name];
  form.elements.enabled.checked = config.enabled;
  for (const name of ['gatewayApiKey', 'uploadKey']) form.elements[name].value = '';
  keyHints();
  $('removeVarta').checked = false; $('removeAzure').checked = false;
  await refresh();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const input = Object.fromEntries(['gatewayIp', 'uploadUrl', 'collectorId'].map(name => [name, form.elements[name].value.trim()])); input.enabled = form.elements.enabled.checked;
  for (const [name, remove] of [['gatewayApiKey', 'removeVarta'], ['uploadKey', 'removeAzure']]) { if ($(remove).checked) input[name] = ''; else if (form.elements[name].value.trim()) input[name] = form.elements[name].value.trim(); }
  try { await api('settings', 'PUT', input); await load(); showMessage('saved'); } catch (error) { showMessage(null, error.message); }
});
for (const [id, path] of [['testVarta', 'test/varta'], ['testAzure', 'test/azure']]) $(id).addEventListener('click', async () => { $(id).disabled = true; showMessage('testing'); try { const result = await api(path, 'POST', {}); showMessage(result.ok ? 'testSuccess' : null, `point: ${result.point} · devices: ${result.devices}`); await refresh(); } catch (error) { showMessage(null, error.message); } finally { $(id).disabled = false; } });
initTranslations();
document.addEventListener('collectorlanguagechange', () => { keyHints(); renderStatus(); renderMessage(); });
try { await load(); } catch (error) { showMessage(null, error.message); }
setInterval(refresh, 5000);

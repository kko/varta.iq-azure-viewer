const texts = {
  language: ['Sprache', 'Language'], title: ['Deine Verbindung zu Azure.', 'Your connection to Azure.'],
  subtitle: ['Abruf und Übertragung alle zehn Sekunden · 30 Tage Ausfallpuffer', 'Collect and upload every ten seconds · 30-day outage buffer'],
  connections: ['Verbindungen', 'Connections'], gatewayIp: ['Gateway-IP', 'Gateway IP'], gatewayKey: ['VARTA-API-Key', 'VARTA API key'],
  removeVarta: ['VARTA-Key entfernen', 'Remove VARTA key'], uploadUrl: ['Azure-Upload-Adresse', 'Azure upload URL'], collectorId: ['Collector-ID', 'Collector ID'],
  uploadKey: ['Upload-Schlüssel', 'Upload key'], removeAzure: ['Upload-Schlüssel entfernen', 'Remove upload key'],
  keyHint: ['Leere Schlüsselfelder behalten gespeicherte Schlüssel. Bei geändertem Ziel den zugehörigen Schlüssel neu eingeben. Einstellungen zuerst speichern, anschließend testen.', 'Leave key fields empty to keep saved keys. Enter a new key when changing its destination. Save settings before testing.'],
  enabled: ['Azure-Upload aktiv', 'Azure upload enabled'], save: ['Speichern', 'Save'], testVarta: ['VARTA testen', 'Test VARTA'], testAzure: ['Azure testen', 'Test Azure'],
  status: ['Aktueller Status', 'Current status'], errors: ['Letzte zehn Fehler', 'Last ten errors'], time: ['Zeit', 'Time'], source: ['Quelle', 'Source'], message: ['Meldung', 'Message'],
  footer: ['Lokale Verwaltung · Geheimnisse werden nicht an den Browser zurückgegeben · Zeiten: Europe/Berlin', 'Local management · Secrets are never returned to the browser · Time zone: Europe/Berlin'],
  error: ['Fehler', 'Error'], stale: ['Warte / veraltet', 'Waiting / stale'], disabled: ['Deaktiviert', 'Disabled'], attempt: ['Versuch', 'Attempt'], success: ['Erfolg', 'Success'],
  confirmed: ['Aktuell bestätigt', 'Latest current upload confirmed'], measurement: ['Messwert', 'Measurement'], missing: ['Veraltet / fehlt', 'Stale / missing'], current: ['Aktuell', 'Current'],
  lastUpload: ['Letzter beliebiger Upload', 'Last confirmed upload'], azureUpload: ['Azure-Upload', 'Azure upload'],
  buffer: ['Puffer: {count} Pakete · ältestes: {oldest} · nach 30 Tagen verworfen: {dropped} · nächste Wiederholung: {retry}', 'Buffer: {count} packets · oldest: {oldest} · discarded after 30 days: {dropped} · next retry: {retry}'],
  noErrors: ['Keine Fehler gespeichert.', 'No errors recorded.'], savedKey: ['Gespeichert · leer lassen zum Beibehalten', 'Saved · leave empty to keep'], noKey: ['Noch nicht gespeichert', 'Not saved yet'],
  saved: ['Einstellungen gespeichert.', 'Settings saved.'], testing: ['Verbindungstest läuft …', 'Testing connection …'], testSuccess: ['Verbindungstest erfolgreich.', 'Connection test successful.']
};
const errors = [
  ['Upload-Schlüssel prüfen.', 'Check the upload key.'], ['API-Key und lokale API prüfen.', 'Check the API key and local API.'],
  ['ungültige Speicherbestätigung.', 'invalid storage confirmation.'], ['Ungültiges Messdatenformat.', 'Invalid measurement format.'], ['Ungültiges Geräteformat.', 'Invalid device format.'],
  ['Pakete nach 30 Tagen verworfen.', 'Packets discarded after 30 days.'], ['Puffer enthält eine andere Collector-ID. Ursprüngliche ID wiederherstellen.', 'Buffer contains a different collector ID. Restore the original ID.'],
  ['Azure hat nur einen Teil der Pakete bestätigt.', 'Azure acknowledged only some of the packets.'],
  ['HTTPS-Adresse mit Pfad /api/ingest erforderlich.', 'An HTTPS URL with path /api/ingest is required.'], ['Collector-ID: 1–64 Buchstaben, Ziffern, _ oder -.', 'Collector ID: 1–64 letters, digits, _ or -.'],
  ['Upload-Schalter ungültig.', 'Invalid upload setting.'], ['Upload-Adresse und Schlüssel erforderlich.', 'Upload URL and key are required.'],
  ['Bitte eine gültige IPv4-Adresse eingeben, z. B. 192.168.4.119.', 'Enter a valid IPv4 address, e.g. 192.168.4.119.'], ['API-Key muss aus maximal 512 sichtbaren ASCII-Zeichen bestehen.', 'API key must contain at most 512 printable ASCII characters.'],
  ['Anfrage zu groß.', 'Request too large.'], ['Ungültiges JSON.', 'Invalid JSON.'], ['Host nicht freigegeben.', 'Host is not allowed.'], ['Methode nicht erlaubt.', 'Method not allowed.'], ['Ungültiger Ursprung.', 'Invalid origin.'], ['JSON erforderlich.', 'JSON required.'],
  ['Einstellungen oder Verbindungstest laufen bereits.', 'Settings or connection test already in progress.'], ['Ziel/Collector-ID erst ändern, wenn der Puffer geleert ist.', 'Empty the buffer before changing the destination or collector ID.'],
  ['Ein anderer Test läuft bereits.', 'Another test is already in progress.'], ['Azure-Einstellungen zuerst speichern.', 'Save Azure settings first.'], ['Azure-Verbindungstest fehlgeschlagen. Siehe Fehlerliste.', 'Azure connection test failed. See the error list.'],
  ['Nicht gefunden.', 'Not found.'], ['Lokaler Vorgang fehlgeschlagen.', 'Local operation failed.'], ['Gateway muss eine IPv4-Adresse sein.', 'Gateway must be an IPv4 address.'], ['Gateway-Zugriff benötigt HTTPS.', 'Gateway access requires HTTPS.'],
  ['Das HTTPS-Gerätezertifikat stimmt nicht mit dem hinterlegten Zertifikat überein.', 'The gateway HTTPS certificate does not match the trusted certificate.'],
  ['Ungültiges Upload-Paket.', 'Invalid upload packet.'], ['Paket außerhalb der Aufbewahrungszeit.', 'Packet is outside the retention window.'], ['Abrufstatus fehlt.', 'Collection status is missing.'], ['Abrufzeit fehlt.', 'Collection time is missing.'],
  ['Ungültige Geräteliste.', 'Invalid device list.'], ['Ungültiger Messzeitpunkt.', 'Invalid measurement timestamp.'], ['Ungültige Gerätemesswerte.', 'Invalid device measurements.'], ['Paket überschreitet die maximale Größe.', 'Packet exceeds the maximum size.'],
  ['[vertraulich]', '[redacted]'], ['[Adresse]', '[address]'],
  ['puffer', 'buffer']
];
let language = 'de';
try { if (localStorage.getItem('varta.collector.language') === 'en') language = 'en'; } catch {}
export const locale = () => language === 'en' ? 'en-GB' : 'de-DE';
export function t(key, values = {}) {
  return (texts[key]?.[language === 'en' ? 1 : 0] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}
export function errorText(value) { return language === 'en' ? errors.reduce((text, [from, to]) => text.replaceAll(from, to), String(value)) : String(value); }
export function initTranslations() {
  const select = document.getElementById('collectorLanguage');
  function apply() { document.documentElement.lang = language; select.value = language; for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n); }
  select.addEventListener('change', () => { language = select.value === 'en' ? 'en' : 'de'; try { localStorage.setItem('varta.collector.language', language); } catch {} apply(); document.dispatchEvent(new Event('collectorlanguagechange')); });
  apply();
}
export const staticTranslations = texts;

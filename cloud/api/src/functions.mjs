import { app } from '@azure/functions';
import { AzureStore } from './storage.mjs';
import { CloudService, keyMatches } from './service.mjs';
import { AuthService, tokenFrom, sessionCookie } from './auth.mjs';

let service;
const getService = () => service ||= new CloudService(new AzureStore(process.env.VARTA_STORAGE_CONNECTION), process.env.VARTA_COLLECTOR_ID || 'varta-home');
let auth;
const getAuth = () => auth ||= new AuthService(new AzureStore(process.env.VARTA_STORAGE_CONNECTION));
const result = (status, jsonBody) => ({ status, jsonBody, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function ingestHandler(request, context) {
  if (!keyMatches(request.headers.get('x-upload-key'), process.env.VARTA_UPLOAD_KEY)) return result(401, { error: 'Upload nicht autorisiert.' });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 1024 * 1024) return result(413, { error: 'Batch zu groß.' });
    let body; try { body = JSON.parse(text); } catch { return result(400, { error: 'Ungültiges JSON.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return result(400, { error: 'JSON-Objekt erforderlich.' });
    if (body.test === true) {
      if (body.collectorId !== getService().collectorId) return result(400, { error: 'Collector-ID stimmt nicht überein.' });
      await getService().putLatest('connectionTest', new Date().toISOString(), { at: new Date().toISOString() });
      return result(200, { ok: true });
    }
    const packets = body.packets || [body];
    if (!Array.isArray(packets) || !packets.length || packets.length > 20) return result(400, { error: '1–20 Pakete erforderlich.' });
    const accepted = [], rejected = [];
    for (const packet of packets) {
      try { accepted.push(await getService().ingest(packet)); }
      catch (error) {
        if (error.statusCode || /parallel/.test(error.message)) throw error;
        rejected.push({ id: packet?.id, error: error.message });
      }
    }
    return result(200, { accepted, rejected });
  } catch (error) { context.error('Speichervorgang fehlgeschlagen', error.code || error.name); return result(503, { error: 'Speicherung derzeit nicht möglich.' }); }
}
export async function readHandler(request, context) {
  try {
    if (!tokenFrom(request)) return result(401, { error: 'Bitte anmelden.' });
    await getAuth().authenticate(tokenFrom(request));
    const name = request.params.name;
    if (name === 'status') return result(200, await getService().status());
    if (name === 'history') { try { return result(200, await getService().history(new URL(request.url).searchParams)); } catch (error) { if (!error.statusCode && /Zeitraum/.test(error.message)) return result(400, { error: error.message }); throw error; } }
    if (!['point', 'devices'].includes(name)) return result(404, { error: 'Nicht gefunden.' });
    const data = await getService().latest(name);
    return data ? result(200, data) : result(503, { error: 'Noch keine Daten hochgeladen.' });
  } catch (error) { if (error.status) return result(error.status, { error: error.message }); context.error('Lesevorgang fehlgeschlagen', error.code || error.name); return result(503, { error: 'Daten derzeit nicht verfügbar.' }); }
}
export async function handleAuth(request, context, service, settings = process.env) {
  try {
    const action = request.params.action, token = tokenFrom(request);
    if (request.method === 'GET') {
      if (action === 'setup') return result(200, { needsSetup: await service.needsSetup() });
      if (action === 'session') return result(200, { user: service.publicUser(await service.authenticate(token, true)) });
      if (action === 'users') return result(200, { users: await service.users(token) });
      return result(404, { error: 'Nicht gefunden.' });
    }
    const expectedOrigin = settings.VARTA_SITE_ORIGIN || new URL(request.url).origin;
    if (request.headers.get('origin') !== expectedOrigin || !request.headers.get('content-type')?.startsWith('application/json')) return result(403, { error: 'Ungültiger Ursprung oder Inhaltstyp.' });
    const text = await request.text();
    if (Buffer.byteLength(text) > 8192) return result(413, { error: 'Anfrage zu groß.' });
    let body; try { body = JSON.parse(text); } catch { return result(400, { error: 'Ungültiges JSON.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return result(400, { error: 'JSON-Objekt erforderlich.' });
    if (action === 'logout') { await service.logout(token); const response = result(200, { ok: true }); response.headers['Set-Cookie'] = sessionCookie('', true); return response; }
    if (action === 'users') return result(200, { user: await service.manageUser(token, body) });
    let session;
    if (action === 'setup') session = await service.setup(body, settings.VARTA_SETUP_KEY);
    else if (action === 'login') session = await service.login(body, (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128));
    else if (action === 'password') session = await service.changePassword(token, body);
    else return result(404, { error: 'Nicht gefunden.' });
    const response = result(200, { user: session.user }); response.headers['Set-Cookie'] = sessionCookie(session.token); return response;
  } catch (error) { if (error.status) return result(error.status, { error: error.message }); context.error('Benutzerverwaltung fehlgeschlagen', error.code || error.name); return result(503, { error: 'Benutzerverwaltung derzeit nicht verfügbar.' }); }
}
export const authHandler = (request, context) => handleAuth(request, context, getAuth());
app.http('ingest', { methods: ['POST'], authLevel: 'anonymous', route: 'ingest', handler: ingestHandler });
app.http('read', { methods: ['GET'], authLevel: 'anonymous', route: '{name}', handler: readHandler });
app.http('auth', { methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'auth/{action}', handler: authHandler });

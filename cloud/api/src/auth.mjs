import { randomBytes, randomUUID, createHash, pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(pbkdf2);
const TABLE = 'VartaAuth', PARTITION = 'auth', HOURS = 8 * 3600000;
export const COOKIE = '__Host-varta-session';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const conflict = error => [409, 412].includes(error.statusCode);
const entity = (rowKey, values) => ({ partitionKey: PARTITION, rowKey, ...values });
const update = (previous, next) => ['update', { ...previous, ...next }, 'Replace', { etag: previous.etag }];
const publicUser = user => ({ username: user.username, email: user.email, role: user.role, disabled: user.disabled, mustChangePassword: user.mustChangePassword });
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(value)) throw fail(400, 'Benutzername: 3–40 Buchstaben, Ziffern, Punkt, _ oder -.');
  return value.toLowerCase();
}
export function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Gültige E-Mail-Adresse eingeben.');
  return email;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 15 || value.length > 128) throw fail(400, 'Passwort muss 15 bis 128 Zeichen lang sein.');
  return value;
}
async function passwordHash(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(value, salt, 600000, 32, 'sha256')).toString('hex')}`;
}
async function matches(value, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(await derive(value, salt, 600000, 32, 'sha256'), Buffer.from(hash, 'hex'));
}
export const sessionCookie = (token, clear = false) => `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : HOURS / 1000}`;
export function tokenFrom(request) {
  const value = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export class AuthService {
  constructor(store) { this.store = store; }
  get(key) { return this.store.get(TABLE, PARTITION, key); }
  transaction(actions) { return this.store.transaction(TABLE, actions); }
  async needsSetup() { return !await this.get('a:state'); }
  async setup(input, expectedKey, now = Date.now()) {
    if (!expectedKey || typeof input.setupKey !== 'string' || !timingSafeEqual(Buffer.from(digest(input.setupKey)), Buffer.from(digest(expectedKey)))) throw fail(403, 'Geschützter Einrichtungslink erforderlich.');
    if (!await this.needsSetup()) throw fail(409, 'Einrichtung bereits abgeschlossen. Bitte anmelden.');
    const email = emailAddress(input.email), name = username(input.username), value = password(input.password);
    if (value === 'varta-iq-viewer') throw fail(400, 'Bitte ein eigenes Passwort statt des bekannten Standardpassworts wählen.');
    const user = entity('u:' + digest(email), { username: name, email, role: 'admin', disabled: false, mustChangePassword: false, passwordHash: await passwordHash(value), version: randomUUID() });
    try { await this.transaction([['create', entity('a:state', { revision: 1 })], ['create', user], ['create', entity('n:' + digest(name), { userKey: user.rowKey })]]); }
    catch (error) { if (conflict(error)) throw fail(409, 'Einrichtung bereits abgeschlossen. Bitte anmelden.'); throw error; }
    return this.newSession(user, now);
  }
  async rateLimit(key, limit, now) {
    const row = 'l:' + digest(key);
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.get(row);
      const active = previous && Date.parse(previous.expiresAt) > now;
      if (active && previous.count >= limit) throw fail(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
      const next = entity(row, { count: active ? previous.count + 1 : 1, expiresAt: active ? previous.expiresAt : new Date(now + 900000).toISOString() });
      try { await this.transaction([previous ? update(previous, next) : ['create', next]]); return; } catch (error) { if (!conflict(error)) throw error; }
    }
    throw fail(429, 'Zu viele gleichzeitige Anmeldeversuche.');
  }
  async newSession(user, now) {
    const token = randomBytes(32).toString('hex');
    await this.transaction([['create', entity('s:' + digest(token), { userKey: user.rowKey, version: user.version, expiresAt: new Date(now + HOURS).toISOString() })]]);
    return { token, user: publicUser(user) };
  }
  async login(input, ip = 'unknown', now = Date.now()) {
    const identifier = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!identifier || identifier.length > 254) throw fail(400, 'Benutzername oder E-Mail eingeben.');
    if (typeof input.password !== 'string' || input.password.length > 128) throw fail(400, 'E-Mail und Passwort eingeben.');
    await this.rateLimit('ip:' + ip, 40, now); await this.rateLimit('identifier:' + identifier, 10, now);
    const key = identifier.includes('@') ? 'u:' + digest(identifier) : (await this.get('n:' + digest(identifier)))?.userKey;
    const user = key ? await this.get(key) : null;
    if (user) await this.rateLimit('user:' + user.rowKey, 10, now);
    // Missing accounts do the same expensive derivation and use the same response.
    const good = await matches(input.password, user?.passwordHash || '00000000000000000000000000000000:' + '00'.repeat(32));
    if (!user || user.disabled || !good) throw fail(401, 'E-Mail oder Passwort falsch.');
    return this.newSession(user, now);
  }
  async authenticate(token, allowPasswordChange = false, now = Date.now()) {
    const session = token && await this.get('s:' + digest(token));
    if (!session || Date.parse(session.expiresAt) <= now) throw fail(401, 'Bitte anmelden.');
    const user = await this.get(session.userKey);
    if (!user || user.disabled || session.version !== user.version) throw fail(401, 'Sitzung abgelaufen. Bitte erneut anmelden.');
    if (user.mustChangePassword && !allowPasswordChange) throw fail(403, 'Passwort muss zuerst geändert werden.');
    return user;
  }
  async logout(token) {
    if (!token) return;
    const session = await this.get('s:' + digest(token));
    if (session) await this.transaction([update(session, { expiresAt: new Date(0).toISOString() })]);
  }
  async changePassword(token, input, now = Date.now()) {
    const user = await this.authenticate(token, true, now);
    await this.rateLimit('password:' + user.rowKey, 10, now);
    if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128 || !await matches(input.currentPassword, user.passwordHash)) throw fail(400, 'Bisheriges Passwort falsch.');
    const nextPassword = password(input.password);
    if (nextPassword === 'varta-iq-viewer' || nextPassword === input.currentPassword) throw fail(400, 'Ein neues, eigenes Passwort wählen.');
    const next = { ...user, passwordHash: await passwordHash(nextPassword), mustChangePassword: false, version: randomUUID() };
    try { await this.transaction([update(user, next)]); } catch (error) { if (conflict(error)) throw fail(409, 'Konto wurde geändert. Bitte erneut anmelden.'); throw error; }
    return this.newSession(next, now);
  }
  async users(token, now = Date.now()) {
    const admin = await this.authenticate(token, false, now);
    if (admin.role !== 'admin') throw fail(403, 'Administratorrechte erforderlich.');
    return (await this.store.query(TABLE, PARTITION, 'u:', 'u;')).map(publicUser).sort((a, b) => a.email.localeCompare(b.email));
  }
  async manageUser(token, input, now = Date.now()) {
    const admin = await this.authenticate(token, false, now);
    if (admin.role !== 'admin') throw fail(403, 'Administratorrechte erforderlich.');
    const email = emailAddress(input.email), key = 'u:' + digest(email);
    if (input.role !== undefined && !['admin', 'viewer'].includes(input.role)) throw fail(400, 'Ungültige Rolle.');
    if (input.disabled !== undefined && typeof input.disabled !== 'boolean') throw fail(400, 'Ungültiger Kontostatus.');
    const hash = input.password === undefined ? undefined : await passwordHash(password(input.password));
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = await this.get('a:state'), previous = await this.get(key);
      if ((await this.authenticate(token, false, now)).role !== 'admin') throw fail(403, 'Administratorrechte erforderlich.');
      if (!state) throw fail(503, 'Benutzerverwaltung nicht eingerichtet.');
      if (!previous && !hash) throw fail(400, 'Startpasswort für neuen Benutzer eingeben.');
      const name = previous?.username || username(input.username);
      const next = entity(key, { ...previous, username: name, email, role: input.role ?? previous?.role ?? 'viewer', disabled: input.disabled ?? previous?.disabled ?? false, mustChangePassword: hash ? true : previous.mustChangePassword, passwordHash: hash || previous.passwordHash, version: randomUUID() });
      if (previous?.role === 'admin' && !previous.disabled && (next.role !== 'admin' || next.disabled)) {
        const users = await this.store.query(TABLE, PARTITION, 'u:', 'u;');
        if (!users.some(user => user.rowKey !== key && user.role === 'admin' && !user.disabled)) throw fail(400, 'Der letzte aktive Administrator darf nicht gesperrt oder herabgestuft werden.');
      }
      // The state ETag serializes administrator changes, including concurrent last-admin checks.
      try { await this.transaction([update(state, { revision: state.revision + 1 }), previous ? update(previous, next) : ['create', next], ...(!previous ? [['create', entity('n:' + digest(name), { userKey: key })]] : [])]); return publicUser(next); }
      catch (error) { if (!conflict(error)) throw error; if (!previous && await this.get('n:' + digest(name))) throw fail(409, 'Benutzername bereits vergeben.'); }
    }
    throw fail(409, 'Gleichzeitige Änderung. Bitte erneut versuchen.');
  }
  publicUser(user) { return publicUser(user); }
}

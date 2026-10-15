import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, sessionCookie, tokenFrom } from '../cloud/api/src/auth.mjs';
import { MemoryStore } from './helpers.mjs';
const KEY = 'setup-secret-for-test-only', OWNER = { username: 'helmut', email: 'helmut@example.test', password: 'Eine lange Testpassphrase!' };
async function initialized() {
  const store = new MemoryStore(), service = new AuthService(store);
  const admin = await service.setup({ ...OWNER, setupKey: KEY }, KEY);
  return { store, service, admin };
}
const status = expected => error => error.status === expected;
test('only the secret setup link can create exactly one first administrator, even concurrently', async () => {
  const store = new MemoryStore(), service = new AuthService(store);
  assert.equal(await service.needsSetup(), true);
  await assert.rejects(service.setup({ ...OWNER, setupKey: 'wrong' }, KEY), status(403));
  await assert.rejects(service.setup({ ...OWNER, password: 'varta-iq-viewer', setupKey: KEY }, KEY), status(400));
  const results = await Promise.allSettled([service.setup({ ...OWNER, setupKey: KEY }, KEY), service.setup({ ...OWNER, username: 'other', email: 'other@example.test', setupKey: KEY }, KEY)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal(await service.needsSetup(), false);
  const admin = results.find(r => r.status === 'fulfilled').value;
  assert.equal((await service.users(admin.token)).length, 1);
  assert.doesNotMatch(JSON.stringify([...store.rows.values()]), /Eine lange Testpassphrase|setup-secret-for-test-only/);
});
test('username and email logins work; cookies are secure; logout and expiry revoke access', async () => {
  const { service } = await initialized();
  for (const email of ['HELMUT', 'Helmut@Example.Test']) {
    const session = await service.login({ email, password: OWNER.password });
    assert.equal((await service.authenticate(session.token)).role, 'admin');
    assert.equal(tokenFrom({ headers: new Headers({ cookie: sessionCookie(session.token) }) }), session.token);
    await service.logout(session.token); await assert.rejects(service.authenticate(session.token), status(401));
  }
  const session = await service.login({ email: OWNER.email, password: OWNER.password });
  await assert.rejects(service.authenticate(session.token, false, Date.now() + 9 * 3600000), status(401));
  await assert.rejects(service.authenticate('forged'), status(401));
  assert.match(sessionCookie(session.token), /HttpOnly; Secure; SameSite=Strict/);
});
test('new users and resets require password changes; viewers cannot administer; old sessions are invalidated', async () => {
  const { service, admin } = await initialized();
  const input = { username: 'viewer', email: 'viewer@example.test', password: 'Temporary Startpasswort!', role: 'viewer' };
  await service.manageUser(admin.token, input);
  let session = await service.login(input);
  assert.equal((await service.authenticate(session.token, true)).mustChangePassword, true);
  await assert.rejects(service.authenticate(session.token), status(403));
  await assert.rejects(service.users(session.token), status(403));
  const oldToken = session.token;
  session = await service.changePassword(session.token, { currentPassword: input.password, password: 'Mein neues eigenes Passwort!' });
  await assert.rejects(service.authenticate(oldToken), status(401));
  assert.equal((await service.authenticate(session.token)).mustChangePassword, false);
  await assert.rejects(service.users(session.token), status(403));
  await assert.rejects(service.manageUser(session.token, { email: OWNER.email, role: 'viewer' }), status(403));
  await service.manageUser(admin.token, { email: input.email, password: 'Ein anderes Startpasswort!' });
  await assert.rejects(service.authenticate(session.token), status(401));
  const reset = await service.login({ email: input.email, password: 'Ein anderes Startpasswort!' });
  await assert.rejects(service.authenticate(reset.token), status(403));
  await service.manageUser(admin.token, { email: input.email, disabled: true });
  await assert.rejects(service.login({ email: input.email, password: 'Ein anderes Startpasswort!' }), status(401));
  assert.ok((await service.users(admin.token)).every(user => !('passwordHash' in user)));
});
test('last administrator survives concurrent demotions; duplicate usernames cannot take another identity', async () => {
  const { service, admin } = await initialized();
  await assert.rejects(service.manageUser(admin.token, { email: OWNER.email, disabled: true }), status(400));
  await assert.rejects(service.manageUser(admin.token, { username: OWNER.username, email: 'copy@example.test', password: OWNER.password }), status(409));
  const second = { username: 'secondadmin', email: 'second@example.test', password: 'Zweites Startpasswort!', role: 'admin' };
  await service.manageUser(admin.token, second);
  const secondSession = await service.login(second);
  const ready = await service.changePassword(secondSession.token, { currentPassword: second.password, password: 'Ein zweites eigenes Passwort!' });
  const results = await Promise.allSettled([service.manageUser(admin.token, { email: OWNER.email, disabled: true }), service.manageUser(ready.token, { email: second.email, disabled: true })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const surviving = results[0].status === 'fulfilled' ? ready.token : admin.token;
  assert.equal((await service.users(surviving)).filter(user => user.role === 'admin' && !user.disabled).length, 1);
});
test('persistent login throttles apply to known and unknown accounts and reset after the window', async () => {
  const { store, service } = await initialized(), now = Date.now();
  for (let i = 0; i < 10; i++) await assert.rejects(service.login({ email: OWNER.email, password: 'wrong' }, 'test', now), status(401));
  const restarted = new AuthService(store);
  await assert.rejects(restarted.login({ email: OWNER.email, password: OWNER.password }, 'test', now), status(429));
  assert.equal((await restarted.login({ email: OWNER.email, password: OWNER.password }, 'test', now + 900001)).user.role, 'admin');
});

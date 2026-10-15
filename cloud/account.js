const $ = id => document.getElementById(id);
let user;
let setupKey = '';
function captureSetupLink() {
  const key = new URLSearchParams(location.hash.slice(1)).get('setup');
  if (key) { setupKey = key; history.replaceState(null, '', location.pathname); $('setupForm').querySelector('button').disabled = false; $('message').textContent = ''; }
}
captureSetupLink();
window.addEventListener('hashchange', captureSetupLink);
async function api(action, body) {
  const response = await fetch('/api/auth/' + action, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { status: response.status });
  return result;
}
async function submit(form, action) {
  const button = form.querySelector('button'); button.disabled = true; $('message').textContent = '';
  try { await action(Object.fromEntries(new FormData(form))); }
  catch (error) { $('message').textContent = error.message; }
  finally { button.disabled = false; }
}
function field(form, title, type, name, value = '') {
  const label = document.createElement('label'); label.textContent = title;
  const input = document.createElement(type === 'select' ? 'select' : 'input'); input.name = name;
  if (type === 'select') for (const [value, title] of [['viewer', 'Betrachter'], ['admin', 'Administrator']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; input.append(option); }
  else { input.type = type; if (type === 'password') { input.autocomplete = 'new-password'; input.minLength = 15; input.maxLength = 128; } }
  if (type === 'checkbox') { input.checked = value; label.className = 'checkbox'; } else input.value = value;
  label.append(input); form.append(label); return input;
}
async function users() {
  const data = await api('users'); $('users').replaceChildren();
  for (const entry of data.users) {
    const card = document.createElement('article'); card.className = 'user-card';
    const title = document.createElement('h3'); title.textContent = entry.email; card.append(title);
    const note = document.createElement('p'); note.textContent = entry.mustChangePassword ? 'Passwortwechsel erforderlich' : 'Passwort eingerichtet'; card.append(note);
    const form = document.createElement('form'); form.className = 'account-form';
    field(form, 'Rolle', 'select', 'role', entry.role);
    const disabled = field(form, 'Benutzer gesperrt', 'checkbox', 'disabled', entry.disabled);
    field(form, 'Neues Startpasswort (leer lassen, um es zu behalten)', 'password', 'password');
    const button = document.createElement('button'); button.textContent = 'Änderungen speichern'; form.append(button);
    form.addEventListener('submit', event => { event.preventDefault(); submit(form, async values => {
      const body = { email: entry.email, role: values.role, disabled: disabled.checked }; if (values.password) body.password = values.password;
      await api('users', body); form.reset(); if (entry.email === user.email) { location.replace('/account.html'); return; }
      await users(); $('message').textContent = 'Benutzer gespeichert.';
    }); });
    card.append(form); $('users').append(card);
  }
}
async function show(current) {
  $('setupPanel').hidden = true;
  user = current; $('loginPanel').hidden = Boolean(user); $('accountPanel').hidden = !user;
  $('dashboard').hidden = !user || user.mustChangePassword; $('usersPanel').hidden = !user || user.role !== 'admin' || user.mustChangePassword;
  if (!user) return;
  $('identity').textContent = user.username + ' · ' + user.email + (user.role === 'admin' ? ' · Administrator' : ' · Betrachter');
  $('requiredChange').hidden = !user.mustChangePassword;
  if (!$('usersPanel').hidden) await users();
}
$('loginForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, async values => { const data = await api('login', values); $('loginForm').reset(); if (!data.user.mustChangePassword) location.replace('/'); else await show(data.user); }); });
$('setupForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, async values => {
  if (values.password !== values.confirmation) throw new Error('Die Passwörter stimmen nicht überein.');
  const data = await api('setup', { username: values.username, email: values.email, password: values.password, setupKey }); $('setupForm').reset();
  if (data.user.mustChangePassword) await show(data.user); else location.replace('/');
}); });
$('passwordForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, async values => {
  if (values.password !== values.confirmation) throw new Error('Die neuen Passwörter stimmen nicht überein.');
  await api('password', { currentPassword: values.currentPassword, password: values.password }); $('passwordForm').reset(); location.replace('/');
}); });
$('createForm').addEventListener('submit', event => { event.preventDefault(); submit(event.currentTarget, async values => { await api('users', values); $('createForm').reset(); await users(); $('message').textContent = 'Benutzer angelegt. Das Startpasswort persönlich weitergeben.'; }); });
$('logout').addEventListener('click', async () => { try { await api('logout', {}); location.replace('/account.html'); } catch (error) { $('message').textContent = error.message; } });
try {
  if ((await api('setup')).needsSetup) {
    $('setupPanel').hidden = false;
    if (!setupKey) { $('setupForm').querySelector('button').disabled = true; $('message').textContent = 'Bitte den persönlichen Einrichtungslink öffnen, um den ersten Administrator anzulegen.'; }
  } else {
    try { await show((await api('session')).user); } catch (error) { if (error.status === 401) await show(null); else throw error; }
  }
} catch (error) { $('message').textContent = error.message; }

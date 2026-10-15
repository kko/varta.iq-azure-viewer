try {
  const response = await fetch('/api/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) { if (response.status === 401) location.replace('/account.html'); else throw new Error('Benutzerkonto derzeit nicht erreichbar. Bitte neu laden.'); }
  else {
    const { user } = await response.json();
    if (user.mustChangePassword) location.replace('/account.html');
    else { document.getElementById('authMessage').remove(); document.querySelector('main').hidden = false; await import('./app.js'); }
  }
} catch (error) { document.getElementById('authMessage').textContent = error.message; }

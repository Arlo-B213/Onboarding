/* LOCAL-ONLY test login. index.html loads this file only when the page is served from
   localhost / 127.0.0.1, and firebase.json keeps it out of every production deploy.
   The accounts below exist only in the local Firebase Auth emulator (created by
   scripts/seed-emulator.mjs); they do not exist in production. Keep the list in sync with that script. */
(function () {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  if (typeof auth === 'undefined' || typeof PrideFx === 'undefined') return;

  const ACCOUNTS = [
    { label: 'Admin', email: 'arlo.bedolla@gmail.com', password: 'Passw0rd!' },
    { label: 'Leader One', email: 'leader1@test.com', password: 'Passw0rd!' },
    { label: 'Leader Two', email: 'leader2@test.com', password: 'Passw0rd!' },
  ];

  const style = document.createElement('style');
  style.textContent = `
    .dev-login { margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--line-gold); }
    .dev-login-label { font-size: 10px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase;
      color: var(--gold-hi); text-align: center; margin-bottom: 10px; }
    .dev-login-row { display: flex; gap: 8px; }
    .dev-login-row .btn { flex: 1; padding: 9px 6px; font-size: 12px; }
    .dev-login-note { font-size: 11px; color: var(--muted); text-align: center; margin-top: 8px; }`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'dev-login';
  box.innerHTML = '<div class="dev-login-label">Local test login</div><div class="dev-login-row"></div>' +
    '<div class="dev-login-note">One click, no password. Emulator only.</div>';
  const row = box.querySelector('.dev-login-row');

  ACCOUNTS.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-outline';
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      const err = document.getElementById('login-error');
      err.classList.remove('show');
      PrideFx.armLogin();
      try {
        await auth.signInWithEmailAndPassword(a.email, a.password);
      } catch (e) {
        PrideFx.disarmLogin();
        err.textContent = 'Test login failed. Are the emulators running and seeded? (node scripts/seed-emulator.mjs)';
        err.classList.add('show');
      }
    });
    row.appendChild(b);
  });

  document.getElementById('view-signin').appendChild(box);
})();

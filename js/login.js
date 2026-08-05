(async function () {
  'use strict';

  const form = document.getElementById('authForm');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const nameEl = document.getElementById('name');
  const codeEl = document.getElementById('code');
  const flowEl = document.getElementById('flow');
  const errorEl = document.getElementById('authError');
  const titleEl = document.getElementById('authTitle');
  const submitBtn = document.getElementById('submitBtn');
  const toggleBtn = document.getElementById('toggleMode');
  const googleBtn = document.getElementById('googleBtn');
  const verifyBlock = document.getElementById('verifyBlock');
  const credBlock = document.getElementById('credBlock');
  const nameBlock = document.getElementById('nameBlock');
  const hintEl = document.getElementById('authHint');

  let mode = 'signIn'; // signIn | signUp | verify
  let pendingEmail = '';

  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || 'arcade.html';

  function safeNext(path) {
    if (!path || path.includes('://') || path.startsWith('//')) return 'arcade.html';
    if (path === 'login.html' || path === 'index.html') return 'arcade.html';
    return path;
  }

  /** Convex Auth accepts paths starting with `/` (or full SITE_URL). */
  function oauthRedirectTo(path) {
    const safe = safeNext(path);
    return safe.startsWith('/') ? safe : `/${safe}`;
  }

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  function prepareBlankCredentials() {
    emailEl.value = '';
    passwordEl.value = '';
    emailEl.autocomplete = 'off';
    passwordEl.autocomplete = 'off';
    emailEl.readOnly = true;
    passwordEl.readOnly = true;
    const unlock = (el) => {
      el.readOnly = false;
    };
    emailEl.addEventListener('focus', () => unlock(emailEl), { once: true });
    passwordEl.addEventListener('focus', () => unlock(passwordEl), { once: true });
  }

  function setMode(nextMode) {
    mode = nextMode;
    showError('');
    if (mode === 'verify') {
      titleEl.textContent = 'Confirm your email';
      hintEl.textContent = `We sent a code to ${pendingEmail}. Enter it below to unlock the arcade.`;
      credBlock.hidden = true;
      nameBlock.hidden = true;
      verifyBlock.hidden = false;
      submitBtn.textContent = 'Confirm & enter';
      toggleBtn.textContent = 'Back to sign in';
      flowEl.value = 'email-verification';
    } else if (mode === 'signUp') {
      titleEl.textContent = 'Create account';
      hintEl.textContent =
        'Enter your email and password below. We’ll email you a code to confirm before you can play.';
      credBlock.hidden = false;
      nameBlock.hidden = false;
      verifyBlock.hidden = true;
      submitBtn.textContent = 'Sign up';
      toggleBtn.textContent = 'Already have an account? Sign in';
      flowEl.value = 'signUp';
      passwordEl.autocomplete = 'new-password';
      emailEl.autocomplete = 'email';
      emailEl.readOnly = false;
      passwordEl.readOnly = false;
      emailEl.focus();
    } else {
      titleEl.textContent = 'Sign in';
      hintEl.textContent = 'Sign in to access My Pragmatict.';
      credBlock.hidden = false;
      nameBlock.hidden = true;
      verifyBlock.hidden = true;
      submitBtn.textContent = 'Sign in';
      toggleBtn.textContent = 'Need an account? Sign up';
      flowEl.value = 'signIn';
      prepareBlankCredentials();
    }
  }

  toggleBtn.addEventListener('click', () => {
    if (mode === 'verify' || mode === 'signUp') setMode('signIn');
    else setMode('signUp');
  });

  await window.ArcadeAuth.init();
  if (window.ArcadeAuth.isAuthenticated()) {
    window.location.replace(safeNext(next));
    return;
  }

  googleBtn.addEventListener('click', async () => {
    showError('');
    googleBtn.disabled = true;
    try {
      await window.ArcadeAuth.signIn('google', {
        redirectTo: oauthRedirectTo(next),
      });
    } catch (err) {
      showError(err.message || 'Google sign-in failed. Is AUTH_GOOGLE_ID configured?');
      googleBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    submitBtn.disabled = true;
    try {
      if (mode === 'verify') {
        const result = await window.ArcadeAuth.signIn('password', {
          email: pendingEmail,
          code: codeEl.value.trim(),
          flow: 'email-verification',
        });
        if (result.signingIn) {
          window.location.replace(safeNext(next));
          return;
        }
        showError('Invalid or expired code. Try again.');
      } else {
        const email = emailEl.value.trim();
        const password = passwordEl.value;
        if (!email || !email.includes('@')) {
          showError('Please enter your email address in the Email field.');
          emailEl.focus();
          return;
        }
        if (!password || password.length < 8) {
          showError('Password must be at least 8 characters.');
          passwordEl.focus();
          return;
        }
        const payload = {
          email,
          password,
          flow: mode === 'signUp' ? 'signUp' : 'signIn',
        };
        if (mode === 'signUp' && nameEl.value.trim()) {
          payload.name = nameEl.value.trim();
        }
        const result = await window.ArcadeAuth.signIn('password', payload);
        if (result.signingIn) {
          window.location.replace(safeNext(next));
          return;
        }
        if (result.needsVerification || mode === 'signUp') {
          pendingEmail = email;
          setMode('verify');
        } else {
          showError('Could not sign in. Check email/password, or confirm your email.');
        }
      }
    } catch (err) {
      const msg = err.message || 'Something went wrong';
      if (/AUTH_RESEND_KEY is not set/i.test(msg)) {
        showError(
          'Confirmation email could not be sent. AUTH_RESEND_KEY is missing on Convex.',
        );
      } else if (/only send testing emails|verify a domain/i.test(msg)) {
        showError(
          'Resend can only email your Resend account address until you verify a domain. Try signing up with etienne.verlinden@gmail.com, or verify mailverlinden.be at resend.com/domains.',
        );
      } else {
        showError(msg);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  setMode('signIn');
})();

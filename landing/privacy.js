// No optional storage is written until the visitor explicitly enables it.
(() => {
  const STORAGE_KEY = 'druse-site-preferences';
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const VERSION = 1;
  let remembered = false;
  let effectsPaused = false;
  let expiresAt = 0;

  function removeStoredPreferences() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('druse-effects-paused');
      return true;
    } catch {
      return false;
    }
  }

  try {
    // Retire the previous unbounded preference without importing its value.
    localStorage.removeItem('druse-effects-paused');
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (
      saved?.version === VERSION &&
      saved.rememberEffects === true &&
      typeof saved.effectsPaused === 'boolean' &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > Date.now() &&
      saved.expiresAt <= Date.now() + MAX_AGE
    ) {
      remembered = true;
      effectsPaused = saved.effectsPaused;
      expiresAt = saved.expiresAt;
    } else if (raw) removeStoredPreferences();
  } catch {
    removeStoredPreferences();
  }

  function writePreference() {
    if (!remembered) return false;
    if (expiresAt <= Date.now()) {
      remembered = false;
      removeStoredPreferences();
      return false;
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: VERSION,
          rememberEffects: true,
          effectsPaused,
          expiresAt,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  window.drusePreferences = Object.freeze({
    getEffectsPaused: () => effectsPaused,
    setEffectsPaused: (value) => {
      effectsPaused = Boolean(value);
      if (remembered && !writePreference()) remembered = false;
    },
  });

  const dialog = document.querySelector('.privacy-dialog');
  const checkbox = document.querySelector('#remember-effects');
  const status = document.querySelector('.privacy-status');
  if (!dialog || !checkbox || !status) return;

  document.querySelectorAll('.privacy-open').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => {
      if (expiresAt && expiresAt <= Date.now()) {
        remembered = false;
        removeStoredPreferences();
      }
      checkbox.checked = remembered;
      status.textContent = '';
      dialog.showModal();
    });
  });

  function forgetPreferences() {
    remembered = false;
    effectsPaused = false;
    expiresAt = 0;
    checkbox.checked = false;
    const removed = removeStoredPreferences();
    window.dispatchEvent(new Event('druse:preferences-reset'));
    status.textContent = removed
      ? 'Preferencias borradas. No guardaremos tu elección de efectos en este navegador.'
      : 'No guardaremos preferencias. El navegador impide comprobar o borrar las anteriores; puedes eliminarlas desde sus ajustes.';
  }

  document
    .querySelector('#privacy-reject')
    .addEventListener('click', forgetPreferences);
  dialog.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', () => dialog.close());
  });
  document.querySelector('#privacy-save').addEventListener('click', () => {
    if (!checkbox.checked) {
      forgetPreferences();
      return;
    }
    remembered = true;
    expiresAt = Date.now() + MAX_AGE;
    if (writePreference())
      status.textContent =
        'Elección guardada durante un máximo de 180 días. Puedes cambiarla o borrarla aquí cuando quieras.';
    else {
      remembered = false;
      checkbox.checked = false;
      status.textContent =
        'El navegador no permite guardar la preferencia. Los efectos seguirán funcionando durante esta visita.';
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.newValue !== null) return;
    remembered = false;
    effectsPaused = false;
    expiresAt = 0;
    checkbox.checked = false;
    window.dispatchEvent(new Event('druse:preferences-reset'));
  });
})();

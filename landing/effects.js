const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const pointerEffects = window.matchMedia(
  '(hover: hover) and (pointer: fine) and (min-width: 761px)',
);
const effectsButton = document.querySelector('.effects-toggle');
const appWindow = document.querySelector('.app-window');
const activeAnimations = new Set();
let userPaused = window.drusePreferences?.getEffectsPaused() ?? false;
let motionEnabled = false;

function animateElement(element, frames, options) {
  if (!motionEnabled || typeof element.animate !== 'function') return;
  const animation = element.animate(frames, options);
  activeAnimations.add(animation);
  animation.finished
    .catch(() => {})
    .finally(() => activeAnimations.delete(animation));
}

function updateMotion() {
  motionEnabled = !reducedMotion.matches && !userPaused;
  document.body.classList.toggle('motion-enabled', motionEnabled);
  document.body.classList.toggle('effects-paused', !motionEnabled);
  effectsButton.setAttribute('aria-pressed', String(!motionEnabled));
  const label = reducedMotion.matches
    ? 'Movimiento reducido del sistema activo'
    : motionEnabled
      ? 'Pausar efectos'
      : 'Activar efectos';
  effectsButton.setAttribute('aria-label', label);
  effectsButton.title = label;
  effectsButton.disabled = reducedMotion.matches;
  if (!motionEnabled) {
    activeAnimations.forEach((animation) => animation.cancel());
    resetTilt();
  }
}

effectsButton.hidden = false;
effectsButton.addEventListener('click', () => {
  userPaused = !userPaused;
  window.drusePreferences?.setEffectsPaused(userPaused);
  updateMotion();
});
window.addEventListener('druse:preferences-reset', () => {
  userPaused = false;
  updateMotion();
});
reducedMotion.addEventListener('change', updateMotion);

function resetTilt() {
  appWindow.style.removeProperty('--tilt-x');
  appWindow.style.removeProperty('--tilt-y');
}

updateMotion();

// Reveal once with Web Animations: content stays visible if JS is disabled,
// an observer is unavailable, or motion gets paused halfway through an entrance.
const revealTargets = document.querySelectorAll(
  '.hero-badge, h1, .hero-description, .hero-actions, .preview-stage, .section-heading, .feature-card, .steps li, .download-section, .faq',
);
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateElement(
          entry.target,
          [
            { opacity: 0, transform: 'translateY(22px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 750, easing: 'cubic-bezier(.2,.7,.2,1)' },
        );
        revealObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.08 },
  );
  revealTargets.forEach((target) => revealObserver.observe(target));
}

// Pointer updates are coalesced into one frame, with no continuous render loop.
document
  .querySelectorAll('.feature-card, .preview-stage')
  .forEach((surface) => {
    const isPreview = surface.classList.contains('preview-stage');
    const target = isPreview ? appWindow : surface;
    let pendingFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    surface.addEventListener('pointermove', (event) => {
      if (
        !motionEnabled ||
        !pointerEffects.matches ||
        event.pointerType === 'touch'
      )
        return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        if (!motionEnabled || !pointerEffects.matches) return;
        const bounds = surface.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(1, (pointerX - bounds.left) / bounds.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (pointerY - bounds.top) / bounds.height),
        );
        target.style.setProperty('--spot-x', `${x * 100}%`);
        target.style.setProperty('--spot-y', `${y * 100}%`);
        if (isPreview) {
          target.style.setProperty('--tilt-x', `${(0.5 - y) * 3}deg`);
          target.style.setProperty('--tilt-y', `${(x - 0.5) * 3}deg`);
        }
      });
    });
    surface.addEventListener('pointerleave', () => {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      if (isPreview) resetTilt();
    });
  });
pointerEffects.addEventListener('change', resetTilt);

const header = document.querySelector('.site-header');
let scrollFrame = 0;
function updateHeader() {
  header.classList.toggle('is-scrolled', window.scrollY > 20);
  scrollFrame = 0;
}
window.addEventListener(
  'scroll',
  () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateHeader);
  },
  { passive: true },
);
updateHeader();

document.querySelectorAll('.faq-list details').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (details.open)
      animateElement(
        details.querySelector('p'),
        [
          { opacity: 0, transform: 'translateY(-5px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 250, easing: 'ease-out' },
      );
  });
});

// A local replay of the illustrative data; this never runs SQL or contacts an API.
const demoButton = document.querySelector('.demo-run');
const resultCount = document.querySelector('.result-count');
const resultRows = document.querySelectorAll('.result-table tbody tr');
demoButton.disabled = false;
demoButton.addEventListener('click', () => {
  demoButton.disabled = true;
  demoButton.textContent = 'Ejecutando…';
  resultCount.textContent = 'Preparando demo…';
  appWindow.classList.add('demo-running');
  const finishDemo = () => {
    resultRows.forEach((row, index) =>
      animateElement(
        row,
        [
          { opacity: 0.25, backgroundColor: '#b38aff45' },
          { opacity: 1, backgroundColor: 'transparent' },
        ],
        { duration: 650, delay: index * 85, easing: 'ease-out' },
      ),
    );
    resultCount.textContent = '4 filas · demo lista';
    demoButton.innerHTML = '<span aria-hidden="true">▶</span> Repetir demo';
    demoButton.disabled = false;
    appWindow.classList.remove('demo-running');
  };
  if (motionEnabled) window.setTimeout(finishDemo, 450);
  else finishDemo();
});

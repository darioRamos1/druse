// Set this to a public Windows installer URL when the first release is ready.
// Keep it null while there is no public download; never link to a private asset.
const WINDOWS_DOWNLOAD_URL = null;

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');

function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Abrir menú');
  navigation.classList.remove('is-open');
}

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  navigation.classList.toggle('is-open', open);
});

navigation.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    menuButton.getAttribute('aria-expanded') === 'true'
  ) {
    closeMenu();
    menuButton.focus();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-wrap')) closeMenu();
});

window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);

if (WINDOWS_DOWNLOAD_URL) {
  const downloadLink = document.querySelector('#download-link');
  const url = new URL(WINDOWS_DOWNLOAD_URL);
  if (url.protocol === 'https:') {
    downloadLink.href = url.href;
    downloadLink.hidden = false;
    document.querySelector('#download-status').textContent =
      'Disponible para Windows. El instalador te permite elegir la edición.';
  }
}

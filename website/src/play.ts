// /play?id=... — Discord RPC butonundan gelen linki lupin://play derin baglantisina cevirir
import { buildDeepLink, openDeepLink } from './shared';

const params = new URLSearchParams(window.location.search);
const id = params.get('id') || '';
const t = Math.max(0, parseInt(params.get('t') || '0', 10) || 0);

const titleEl = document.getElementById('title');
const subEl = document.getElementById('sub');
const openBtn = document.getElementById('open') as HTMLButtonElement | null;
const hintEl = document.getElementById('hint');

if (!id) {
  if (titleEl) titleEl.textContent = 'Link eksik görünüyor';
  if (subEl) subEl.textContent = 'Şarkı kimliği bulunamadı — Discord kartını yenileyip tekrar dene.';
  if (openBtn) openBtn.style.display = 'none';
} else if (titleEl && subEl && openBtn && hintEl) {
  const link = buildDeepLink('play', id, t);
  let opened = false;
  window.addEventListener('blur', () => {
    opened = true;
  });

  openBtn.addEventListener('click', () => {
    openDeepLink(link);
    setTimeout(() => {
      if (!opened && !document.hidden) hintEl.classList.add('show');
    }, 1600);
  });
}

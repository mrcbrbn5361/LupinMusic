// Paylasilan derin baglanti yardimcilari — app.ts:handleDeepLink ile sozlesme aynidir
export function buildDeepLink(action: 'party' | 'play', id: string, t: number): string {
  const safeId = encodeURIComponent(id);
  const safeT = Math.max(0, Math.floor(t) || 0);
  return `lupin://${action}?id=${safeId}&t=${safeT}`;
}

export function openDeepLink(link: string): void {
  // Tarayici bilinmeyen protokolde hata firlatabilir; yutulur, hint paneli devreye girer
  try {
    window.location.href = link;
  } catch (e) {
    console.warn('deep link failed', e);
  }
}

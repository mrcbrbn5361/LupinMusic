/**
 * Lupin Music — "Şu anda çalınıyor" kartı (Discord webhook + bot için ortak tasarım).
 * Duzen Aurora tarzi listening kartindan; palet Lupin neon obsidyen (#090214/#ec4899/#8b5cf6).
 * Cikti: PNG base64 (data URL prefiksi olmadan) — ana surec multipart webhook'a yukler.
 */

export interface NowPlayingCardData {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  currentSec?: number;
  durationSec?: number;
  username?: string;
  avatarUrl?: string;
  appLabel?: string;
}

const W = 1200;
const H = 470;

const BG_DEEP = '#05010c';
const BG_PANEL = '#0d0618';
const ACCENT = '#ec4899';
const ACCENT_2 = '#8b5cf6';
const TEXT = '#ffffff';
const BODY = '#d8b4fe';
const MUTED = '#9333ea';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width <= maxWidth) {
      line = probe;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  let out = lines.join('\n');
  if (out !== text && ctx.measureText(out.split('\n').pop() as string).width > maxWidth) {
    const last = out.split('\n');
    let tail = last[last.length - 1];
    while (tail.length > 1 && ctx.measureText(`${tail}…`).width > maxWidth) tail = tail.slice(0, -1);
    last[last.length - 1] = `${tail.trimEnd()}…`;
    out = last.join('\n');
  }
  return out;
}

function fmt(sec: number): string {
  const s = !isFinite(sec) || sec < 0 ? 0 : Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCoverFallback(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#1b0a33');
  g.addColorStop(1, '#090214');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(236, 72, 153, 0.55)';
  ctx.font = '700 92px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('L', x + size / 2, y + size / 2 + 4);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

async function drawRoundImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number
): Promise<void> {
  const scale = Math.max(size / img.width, size / img.height);
  const sw = size / scale;
  const sh = size / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, size, size);
  ctx.restore();
}

/** Karti cizer ve PNG base64 dondurur. */
export async function renderNowPlayingCard(data: NowPlayingCardData): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context yok');

  // Zemin: obsidyen + yumusak neon hizalari
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BG_PANEL);
  bg.addColorStop(0.55, BG_DEEP);
  bg.addColorStop(1, '#0a0416');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 22);
  ctx.fill();

  const glowA = ctx.createRadialGradient(180, 120, 10, 180, 120, 620);
  glowA.addColorStop(0, 'rgba(236, 72, 153, 0.22)');
  glowA.addColorStop(1, 'rgba(236, 72, 153, 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);

  const glowB = ctx.createRadialGradient(W - 120, H - 60, 10, W - 120, H - 60, 520);
  glowB.addColorStop(0, 'rgba(139, 92, 246, 0.20)');
  glowB.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(236, 72, 153, 0.38)';
  ctx.lineWidth = 1.6;
  roundRect(ctx, 0.8, 0.8, W - 1.6, H - 1.6, 21);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.14)';
  ctx.lineWidth = 1;
  roundRect(ctx, 6, 6, W - 12, H - 12, 17);
  ctx.stroke();

  // NOW PLAYING rozeti
  ctx.fillStyle = ACCENT;
  roundRect(ctx, 56, 48, 8, 26, 4);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('NOW PLAYING', 78, 68);
  ctx.letterSpacing = '0px';

  // Kapak
  const coverSize = 220;
  const coverX = 56;
  const coverY = 96;
  const cover = data.coverUrl ? await loadImage(data.coverUrl) : null;
  if (cover) {
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.35)';
    ctx.shadowBlur = 28;
    drawRoundImage(ctx, cover, coverX, coverY, coverSize, 18);
    ctx.restore();
  } else {
    drawCoverFallback(ctx, coverX, coverY, coverSize);
  }
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.45)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, coverX + 0.5, coverY + 0.5, coverSize - 1, coverSize - 1, 18);
  ctx.stroke();

  // Metin kolonu
  const textX = coverX + coverSize + 64;
  const maxTextWidth = W - textX - 56;

  ctx.fillStyle = TEXT;
  ctx.font = '700 46px "Segoe UI", system-ui, sans-serif';
  const title = fitText(ctx, data.title || 'Bilinmeyen Parça', maxTextWidth, 2);
  ctx.fillText(title, textX, 150);

  const titleBottom = title.includes('\n') ? 196 : 172;
  ctx.fillStyle = BODY;
  ctx.font = '500 30px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(fitText(ctx, data.artist || 'Bilinmeyen Sanatçı', maxTextWidth, 1), textX, titleBottom + 34);

  ctx.fillStyle = MUTED;
  ctx.font = '400 24px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(fitText(ctx, data.album || 'Lupin Music', maxTextWidth, 1), textX, titleBottom + 68);

  // Ilerleme cubugu
  const barX = 56;
  const barW = W - 112;
  const barY = 356;
  const barH = 10;
  const dur = Math.max(0, data.durationSec || 0);
  const ratio = dur > 0 ? Math.min(1, Math.max(0, (data.currentSec || 0) / dur)) : 0;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  if (ratio > 0) {
    const fillW = Math.max(barH, barW * ratio);
    const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    fillGrad.addColorStop(0, ACCENT_2);
    fillGrad.addColorStop(1, ACCENT);
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.55)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = fillGrad;
    roundRect(ctx, barX, barY, fillW, barH, barH / 2);
    ctx.fill();
    ctx.restore();

    const knobX = barX + fillW;
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(knobX, barY + barH / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = '500 22px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = BODY;
  ctx.fillText(fmt(data.currentSec || 0), barX, barY + 40);
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.fillText(fmt(dur), barX + barW, barY + 40);
  ctx.textAlign = 'left';

  // Ayirici + footer
  const lineY = 424;
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, lineY);
  ctx.lineTo(W - 56, lineY);
  ctx.stroke();

  const avatarSize = 30;
  const avatarY = lineY + 14;
  const avatar = data.avatarUrl ? await loadImage(data.avatarUrl) : null;
  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(56 + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 56, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } else {
    const seal = await loadImage('./logo.png');
    if (seal) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(56 + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(seal, 56, avatarY, avatarSize, avatarSize);
      ctx.restore();
    }
  }

  ctx.fillStyle = TEXT;
  ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(data.username || 'Lupin Music', 56 + avatarSize + 14, avatarY + 22);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 18px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(data.appLabel || 'Lupin Music', W - 56, avatarY + 22);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png').split(',')[1] || '';
}

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

function roundRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'number') {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x + radius.tl, y);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
  if (!text) return '';
  if (maxWidth <= 0) return '...';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.trim() + '...';
}

function formatTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Lupin Music — Ultra Luxury Neon Purple & Magenta Player Card
 */
async function renderPlayerCard({
  title = 'Bilinmeyen Şarkı',
  artist = 'Bilinmeyen Sanatçı',
  album = 'Lupin Music',
  coverUrl = null,
  currentSec = 0,
  durationSec = 0,
  username = 'Kullanıcı',
  suggestions = []
}) {
  const width = 720;
  const height = 360;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Deep Obsidian Purple Background with Radial Neon Glow
  const bgGrad = ctx.createRadialGradient(width * 0.2, height * 0.3, 20, width * 0.5, height * 0.5, width * 0.8);
  bgGrad.addColorStop(0, '#270c47');
  bgGrad.addColorStop(0.5, '#120424');
  bgGrad.addColorStop(1, '#07010f');

  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, width, height, 22);
  ctx.fill();

  // Outer Border with Neon Pink/Purple Glow
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.45)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Inner subtle border
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, 3, 3, width - 6, height - 6, 20);
  ctx.stroke();

  // Watermark Emblem in Background (top right)
  const logoPath = path.join(__dirname, 'assets/lupin_logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      const logoImg = await loadImage(logoPath);
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.drawImage(logoImg, width - 260, -40, 300, 300);
      ctx.restore();
    } catch (e) {}
  }

  // Cover Art (Left Side)
  const coverSize = 160;
  const coverX = 26;
  const coverY = 26;

  ctx.save();
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 16);
  ctx.clip();

  let coverLoaded = false;
  if (coverUrl) {
    try {
      const img = await loadImage(coverUrl);
      ctx.drawImage(img, coverX, coverY, coverSize, coverSize);
      coverLoaded = true;
    } catch (err) {
      console.warn('[CardRenderer] Kapak resmi yüklenemedi:', err.message);
    }
  }

  if (!coverLoaded && fs.existsSync(logoPath)) {
    try {
      const logoImg = await loadImage(logoPath);
      ctx.drawImage(logoImg, coverX, coverY, coverSize, coverSize);
      coverLoaded = true;
    } catch (e) {}
  }

  if (!coverLoaded) {
    ctx.fillStyle = '#1c0936';
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
    ctx.fillStyle = '#ec4899';
    ctx.font = 'bold 44px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♫', coverX + coverSize / 2, coverY + coverSize / 2);
  }
  ctx.restore();

  // Cover Art Glowing Border
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.5)';
  ctx.lineWidth = 2;
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 16);
  ctx.stroke();

  // Top Badge: "LUPIN MUSIC • ŞU ANDA ÇALINIYOR"
  const badgeX = coverX + coverSize + 22;
  const badgeY = 26;
  const badgeW = 210;
  const badgeH = 26;

  ctx.fillStyle = 'rgba(236, 72, 153, 0.18)';
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 13);
  ctx.fill();
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Pulsing Dot in Badge
  ctx.beginPath();
  ctx.arc(badgeX + 14, badgeY + 13, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ec4899';
  ctx.fill();

  ctx.fillStyle = '#fdf2f8';
  ctx.font = 'bold 11px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('LUPIN MUSIC • ŞU ANDA ÇALINIYOR', badgeX + 24, badgeY + 14);

  // Track Title
  const textX = badgeX;
  const maxTextW = width - textX - 30;

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(truncateText(ctx, title, maxTextW), textX, 62);

  // Artist & Album
  ctx.fillStyle = '#d8b4fe';
  ctx.font = '600 15px Segoe UI, sans-serif';
  const artistText = artist + (album ? ` • ${album}` : '');
  ctx.fillText(truncateText(ctx, artistText, maxTextW), textX, 94);

  // User info pill
  ctx.fillStyle = '#9333ea';
  ctx.font = '12px Segoe UI, sans-serif';
  ctx.fillText(`Dinleyen: @${username}`, textX, 120);

  // Progress Bar
  const progX = textX;
  const progY = 150;
  const progW = maxTextW;
  const progH = 8;

  // Background Bar
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  roundRect(ctx, progX, progY, progW, progH, 4);
  ctx.fill();

  // Progress Fill (Gradient Pink to Violet)
  const ratio = durationSec > 0 ? Math.min(1, Math.max(0, currentSec / durationSec)) : 0;
  const fillW = Math.max(6, progW * ratio);

  const fillGrad = ctx.createLinearGradient(progX, progY, progX + fillW, progY);
  fillGrad.addColorStop(0, '#ec4899');
  fillGrad.addColorStop(1, '#a855f7');

  ctx.fillStyle = fillGrad;
  roundRect(ctx, progX, progY, fillW, progH, 4);
  ctx.fill();

  // Glowing Handle Circle
  ctx.beginPath();
  ctx.arc(progX + fillW, progY + progH / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Time labels
  ctx.font = '12px Segoe UI, sans-serif';
  ctx.fillStyle = '#d8b4fe';
  ctx.textAlign = 'left';
  ctx.fillText(formatTime(currentSec), progX, 168);

  ctx.textAlign = 'right';
  ctx.fillText(formatTime(durationSec), progX + progW, 168);

  // Divider Line
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(26, 212);
  ctx.lineTo(width - 26, 212);
  ctx.stroke();

  // Suggestions Section
  ctx.fillStyle = '#f472b6';
  ctx.font = 'bold 12.5px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('✨ Şarkı Önerileri & Benzer Parçalar:', 26, 236);

  const sugList = suggestions && suggestions.length > 0 ? suggestions.slice(0, 3) : [
    { title: 'Lupin Night Vibes', artist: 'Lupin Music' },
    { title: 'Obsidian Dreams', artist: 'Cyberpunk Chill' },
    { title: 'Neon Highway', artist: 'Synthwave' }
  ];

  const colW = (width - 52 - 20) / 3;
  sugList.forEach((sug, i) => {
    const sx = 26 + i * (colW + 10);
    const sy = 254;

    ctx.fillStyle = 'rgba(28, 10, 52, 0.7)';
    roundRect(ctx, sx, sy, colW, 72, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Segoe UI, sans-serif';
    ctx.fillText(truncateText(ctx, sug.title, colW - 20), sx + 10, sy + 24);

    ctx.fillStyle = '#c084fc';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText(truncateText(ctx, sug.artist, colW - 20), sx + 10, sy + 44);
  });

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderPlayerCard
};

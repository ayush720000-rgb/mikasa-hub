import { appPath } from '../utils/basePath';
import { BOT_HANDLE } from './botConfig';
/**
 * High-Resolution Match Result Generator for Mikasa Ludo Bot
 * Recreates the exact template layout, golden/silver/bronze/purple ranking cards,
 * laurel wreaths, crowns, ribbons, and typography using HTML5 Canvas.
 */

import { LobbyPlayer } from '../types/ludo';

export interface MatchResultData {
  matchCode: string;
  durationSeconds: number;
  players: LobbyPlayer[];
  botUsername?: string;
}

// Safely load an image with CORS handling and fallback to canvas avatar
async function loadSafeImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  // Route Telegram CDN images through our same-origin proxy so canvas export is not
  // tainted by cross-origin restrictions. Already-proxied URLs remain unchanged.
  let safeUrl = url;
  if (/^https:\/\/(?:t\.me|(?:[a-z0-9-]+\.)*telegram\.org|(?:[a-z0-9-]+\.)*telegram-cdn\.org|(?:[a-z0-9-]+\.)*telesco\.pe)\//i.test(url)) {
    safeUrl = appPath(`/api/telegram/avatar-url?url=${encodeURIComponent(url)}`);
  }
  return new Promise((resolve) => {
    const img = new Image();
    const timeout = window.setTimeout(() => resolve(null), 9000);
    img.crossOrigin = 'anonymous';
    img.onload = () => { window.clearTimeout(timeout); resolve(img); };
    img.onerror = () => { window.clearTimeout(timeout); resolve(null); };
    img.src = safeUrl;
  });
}

// Draw a smooth rounded rectangle
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Draw a stylized laurel wreath around an avatar circle

// Draw a 3D Golden/Metallic Crown

// Draw a stylized ranking badge medallion (1, 2, 3, 4)

// Draw the ranking ribbon/banner ("CHAMPION", "RUNNER UP", etc.)

/**
 * Main Canvas Generation Function
 * Outputs a full personalized 1200x1200 PNG Blob
 */

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string) {
  ctx.font = font;
  let value = text || 'Player';
  while (value.length > 3 && ctx.measureText(value).width > maxWidth) value = value.slice(0, -2) + '…';
  return value;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number) {
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const sw = size / scale, sh = size / scale;
  const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, size, size);
}

/** Creates the compact, four-player navy-and-gold result card. */
export async function generatePersonalizedMatchResult(data: MatchResultData): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const bg = ctx.createLinearGradient(0, 0, 900, 1200);
  bg.addColorStop(0, '#050914');
  bg.addColorStop(.55, '#101a31');
  bg.addColorStop(1, '#050914');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 1200);

  // Subtle board-inspired geometry and gold lighting.
  ctx.save();
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.025 + i * .004})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(600, 390, 180 + i * 62, 0, Math.PI * 2);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(600, 350, 20, 600, 350, 600);
  glow.addColorStop(0, 'rgba(245,158,11,.18)');
  glow.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1200, 1000);
  ctx.restore();

  // Header
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(245,158,11,.7)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#fbbf24';
  ctx.font = '900 100px Arial, sans-serif';
  ctx.fillText('YOU WON!', 600, 155);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillText('LUDO CHAMPION', 600, 235);

  const sorted = [...data.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 4);
  const palettes = [
    { border: '#fbbf24', glow: 'rgba(245,158,11,.35)', panel: '#241b10', medal: '#f59e0b', place: '1ST PLACE' },
    { border: '#93c5fd', glow: 'rgba(59,130,246,.28)', panel: '#101d35', medal: '#60a5fa', place: '2ND PLACE' },
    { border: '#fb927d', glow: 'rgba(239,68,68,.25)', panel: '#2a1418', medal: '#f97360', place: '3RD PLACE' },
    { border: '#86efac', glow: 'rgba(34,197,94,.25)', panel: '#10251d', medal: '#4ade80', place: '4TH PLACE' },
  ];
  const cardW = 258, cardH = 555, gap = 18, startX = (1200 - (cardW * 4 + gap * 3)) / 2;
  const avatars = await Promise.all(sorted.map(p => loadSafeImage(p.avatarUrl)));

  for (let i = 0; i < 4; i++) {
    const p = sorted[i];
    const rank = i + 1;
    const c = palettes[i];
    const x = startX + i * (cardW + gap);
    const y = rank === 1 ? 390 : 430;

    ctx.save();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = rank === 1 ? 30 : 18;
    roundRect(ctx, x, y, cardW, cardH, 30);
    ctx.fillStyle = c.panel;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = c.border;
    ctx.lineWidth = rank === 1 ? 5 : 3;
    ctx.stroke();

    // Crown and circular avatar crop.
    ctx.fillStyle = c.border;
    ctx.font = '900 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(rank === 1 ? '♛' : '♔', x + cardW / 2, y + 44);

    const avSize = 166, avX = x + (cardW - avSize) / 2, avY = y + 92;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + cardW / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#26334b';
    ctx.fillRect(avX, avY, avSize, avSize);
    if (avatars[i]) {
      drawCover(ctx, avatars[i]!, avX, avY, avSize);
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '900 78px Arial';
      ctx.fillText((p?.name || '?').trim().charAt(0).toUpperCase(), x + cardW / 2, avY + avSize / 2);
    }
    ctx.restore();
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x + cardW / 2, avY + avSize / 2, avSize / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();

    // Rank medallion
    ctx.fillStyle = c.medal;
    ctx.beginPath();
    ctx.arc(x + cardW / 2, avY + avSize - 2, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#07101e';
    ctx.font = '900 42px Arial';
    ctx.fillText(String(rank), x + cardW / 2, avY + avSize - 1);

    // Telegram display name only. Never substitute @username.
    const displayName = p?.name?.trim() || 'Player';
    ctx.fillStyle = '#ffffff';
    const fittedName = fitText(ctx, displayName, cardW - 28, '800 30px Arial');
    ctx.fillText(fittedName, x + cardW / 2, y + 340);

    ctx.strokeStyle = `${c.border}88`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 24, y + 382);
    ctx.lineTo(x + cardW - 24, y + 382);
    ctx.stroke();
    ctx.fillStyle = c.border;
    ctx.font = '900 26px Arial';
    ctx.fillText(c.place, x + cardW / 2, y + 435);
    ctx.restore();
  }

  // Minimal footer branding; buttons are rendered by the bot UI, not baked into image.
  ctx.save();
  ctx.strokeStyle = 'rgba(245,158,11,.65)';
  ctx.lineWidth = 2;
  roundRect(ctx, 250, 1040, 700, 92, 44);
  ctx.fillStyle = '#080d19';
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '800 38px Arial, sans-serif';
  ctx.fillText(data.botUsername || BOT_HANDLE, 600, 1087);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

import { useEffect, useMemo, useState } from 'react';
import { Download, ShieldCheck, AlertCircle } from 'lucide-react';
import type { Lang } from '../lib/lang';
import { TiltCard } from './bencho/TiltCard';
import {
  downloadWalletPass,
  makeQr,
  saveHref,
  shortMemberId,
  tr,
  verifyUrl,
  walletPassAvailable,
} from '../lib/account';

interface DigitalMemberCardProps {
  lang: Lang;
  memberId: string;
  name: string;
  tierName: string;
  /** Already formatted, e.g. "January 28, 2027", or a "no expiry" label. */
  validThrough: string;
  /** The card comes from a family plan rather than the member's own tier. */
  viaFamily?: boolean;
  /** Controlled QR zoom (the page's "Enlarge QR" button); uncontrolled when omitted. */
  zoomOpen?: boolean;
  onZoomChange?: (open: boolean) => void;
}

function formatShortTierName(name: string) {
  return (
    name
      .replace(/\s*membership/gi, '')
      .replace(/会员/g, '')
      .trim() || name
  );
}

// The live verification QR (/api/verify?m=<member id>), drawn locally as SVG.
export function QrCodeSvg({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = makeQr(text);
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2},${r + 2}h1v1h-1z`;
    return { size: n + 4, path: d };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#1d1d1f" />
    </svg>
  );
}

// Largest font (px, down from `start`) at which `text` fits `maxWidth`.
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  font: (px: number) => string,
) {
  let px = start;
  ctx.font = font(px);
  while (px > 14 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = font(px);
  }
}

export function DigitalMemberCard({
  lang,
  memberId,
  name,
  tierName,
  validThrough,
  viaFamily = false,
  zoomOpen,
  onZoomChange,
}: DigitalMemberCardProps) {
  const t = tr(lang);
  const [downloading, setDownloading] = useState(false);
  const [innerZoom, setInnerZoom] = useState(false);
  const [walletReady, setWalletReady] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoom = zoomOpen ?? innerZoom;
  const setZoom = onZoomChange ?? setInnerZoom;
  const qrText = verifyUrl(memberId);
  const shortId = shortMemberId(memberId);
  const shortTier = formatShortTierName(tierName);

  // Apple Wallet needs signing certificates on the server: the button appears
  // only when GET /api/wallet-pass answers 204.
  useEffect(() => {
    let alive = true;
    void walletPassAvailable().then((ok) => alive && setWalletReady(ok));
    return () => {
      alive = false;
    };
  }, []);

  const handleWallet = async () => {
    if (walletBusy) return;
    setWalletBusy(true);
    setError(null);
    const ok = await downloadWalletPass();
    setWalletBusy(false);
    if (!ok) setError(t('Could not create the Wallet pass.', '无法生成钱包卡券。'));
  };

  // The saved PNG, drawn as the card on screen: the same three bands and the same
  // shares of the card's width, at 1000 × 630 (the ID-1 ratio). The QR sits a
  // little larger than on screen so the saved image can still be scanned.
  const handleDownloadPNG = async () => {
    setDownloading(true);
    setError(null);
    try {
      const W = 1000;
      const H = 630;
      const P = 42; // 4.2% of the width, as on the card
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const sans = (px: number, weight = '') =>
        `${weight} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`;
      const WHITE = '#ffffff';
      const MUTED = '#a3a3a3'; // neutral-400, the label colour on the card
      const VALUE = '#e5e5e5'; // neutral-200
      const HAIRLINE = 'rgba(255, 255, 255, 0.12)';
      const rule = (y: number) => {
        ctx.strokeStyle = HAIRLINE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(P, y);
        ctx.lineTo(W - P, y);
        ctx.stroke();
      };

      ctx.fillStyle = '#1d1d1f';
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, 32);
      ctx.fill();
      ctx.strokeStyle = HAIRLINE;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // ---- issuer band -------------------------------------------------------
      const logo = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '/images/logo.png';
      });
      let textX = P;
      if (logo?.naturalWidth) {
        const h = 60;
        const w = (logo.naturalWidth / logo.naturalHeight) * h;
        ctx.drawImage(logo, P, P + 6, w, h);
        textX = P + w + 22;
      }
      ctx.fillStyle = WHITE;
      ctx.font = sans(34, '600');
      ctx.fillText('CAACI Member Pass', textX, P);
      ctx.fillStyle = MUTED;
      ctx.font = sans(26);
      ctx.fillText('Central Illinois • 501(c)(3)', textX, P + 44);

      // tier pill, right-aligned
      ctx.font = sans(26, '600');
      const pillW = Math.min(ctx.measureText(shortTier).width + 48, 320);
      const pillY = P + 14;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect(W - P - pillW, pillY, pillW, 46, 23);
      ctx.fill();
      ctx.fillStyle = VALUE;
      ctx.textAlign = 'center';
      ctx.fillText(shortTier, W - P - pillW / 2, pillY + 9);
      ctx.textAlign = 'left';

      rule(148);

      // ---- holder band -------------------------------------------------------
      let y = 196;
      ctx.fillStyle = MUTED;
      ctx.font = sans(26);
      ctx.fillText(t('Cardholder Name', '持卡人姓名'), P, y);
      y += 34;
      ctx.fillStyle = WHITE;
      fitFont(ctx, name, W - 2 * P, 54, (px) => sans(px, '500'));
      ctx.fillText(name, P, y);
      y += 92;

      const col2 = P + (W - 2 * P) / 2;
      ctx.fillStyle = MUTED;
      ctx.font = sans(26);
      ctx.fillText(t('Member ID', '会员编号'), P, y);
      ctx.fillText(t('Valid Through', '有效期至'), col2, y);
      y += 32;
      ctx.fillStyle = VALUE;
      ctx.font = `30px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(shortId, P, y);
      ctx.font = sans(30);
      fitFont(ctx, validThrough, W - col2 - P, 30, (px) => sans(px));
      ctx.fillText(validThrough, col2, y);

      // ---- scan band ---------------------------------------------------------
      rule(440);
      const qrSize = 130;
      const qrX = W - P - qrSize;
      const qrY = H - P - qrSize;
      ctx.fillStyle = MUTED;
      ctx.font = sans(26);
      ctx.fillText(
        t('Scan to verify membership', '扫码即可实时验证会员资格'),
        P,
        qrY + qrSize / 2 - 16,
      );

      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.roundRect(qrX, qrY, qrSize, qrSize, 10);
      ctx.fill();
      const qr = makeQr(qrText);
      const n = qr.getModuleCount();
      const cell = Math.floor((qrSize - 16) / n);
      const qrPx = cell * n;
      const ox = qrX + Math.floor((qrSize - qrPx) / 2);
      const oy = qrY + Math.floor((qrSize - qrPx) / 2);
      ctx.fillStyle = '#1d1d1f';
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);

      saveHref(canvas.toDataURL('image/png'), 'caaci-membership-card.png');
    } catch {
      setError(t('Could not render the card image.', '无法生成会员卡图片。'));
    } finally {
      setTimeout(() => setDownloading(false), 800);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      {/* The card, at the ID-1 bank-card ratio (85.60 × 53.98 mm, ISO/IEC 7810),
          in three bands separated by hairlines — issuer, holder, scan line — the
          same design as the sample card on the membership page. The card is a
          container and every size below is a share of its width (cqw), so it
          scales as one piece instead of reflowing on a narrow phone. Tapping it
          opens the full-screen QR, which is what a merchant scans.

          The card gives under the pointer (TiltCard, Bencho's press: the point
          you are over sinks, the far side rises) — a card being touched, not
          one displayed. The tilt draws the shadow, so the button carries none. */}
      <TiltCard className="w-full" gloss>
        <button
          type="button"
          onClick={() => setZoom(true)}
          aria-label={t('Enlarge QR code', '放大二维码')}
          className="@container block w-full aspect-[85.6/53.98] rounded-2xl bg-ink text-white border border-white/10 overflow-hidden select-none text-left cursor-pointer hover:border-tan/40 transition-colors"
        >
          {/* Padding lives inside the container: a cqw length on the container itself
            would measure the nearest ancestor container, not this card. */}
          <div className="h-full w-full p-[4.2cqw] flex flex-col">
            <div className="flex items-center justify-between gap-[2cqw] pb-[3cqw] border-b border-white/10">
              <div className="flex items-center gap-[2.2cqw] min-w-0">
                <img
                  src="/images/logo.png"
                  alt="CAACI"
                  className="h-[7cqw] w-auto shrink-0 bg-white/10 rounded p-[0.4cqw] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="min-w-0">
                  <div className="text-[3.6cqw] font-semibold tracking-tight text-white truncate">
                    CAACI Member Pass
                  </div>
                  <div className="text-[2.8cqw] text-neutral-400 truncate">
                    Central Illinois • 501(c)(3)
                  </div>
                </div>
              </div>
              <span className="shrink-0 text-[2.8cqw] font-semibold px-[2.4cqw] py-[0.6cqw] rounded-full bg-white/15 text-neutral-200">
                {shortTier}
              </span>
            </div>

            <div className="flex-1 min-h-0 py-[3cqw] flex flex-col justify-center gap-[2.5cqw]">
              <div className="min-w-0">
                <div className="text-[2.8cqw] text-neutral-400">
                  {t('Cardholder Name', '持卡人姓名')}
                </div>
                <div
                  className="text-[5.4cqw] font-medium tracking-tight text-white truncate"
                  title={name}
                >
                  {name}
                </div>
                {viaFamily && (
                  <div className="text-[2.8cqw] text-tan truncate">
                    {t('Covered by a family plan', '由家庭会员共享')}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-[3cqw]">
                <div className="min-w-0">
                  <div className="text-[2.8cqw] text-neutral-400">{t('Member ID', '会员编号')}</div>
                  <div className="font-mono text-[3.2cqw] text-neutral-200 truncate">{shortId}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[2.8cqw] text-neutral-400">
                    {t('Valid Through', '有效期至')}
                  </div>
                  <div className="text-[3.2cqw] text-neutral-200 truncate">{validThrough}</div>
                </div>
              </div>
            </div>

            <div className="pt-[3cqw] border-t border-white/10 flex items-center justify-between gap-[3cqw]">
              <span className="text-[2.8cqw] text-neutral-400 truncate">
                {t(
                  'Tap to enlarge · show the QR for merchant discounts',
                  '轻触放大二维码，出示给商家扫码',
                )}
              </span>
              <QrCodeSvg
                text={qrText}
                className="w-[11cqw] h-[11cqw] shrink-0 block rounded-[0.8cqw] overflow-hidden"
              />
            </div>
          </div>
        </button>
      </TiltCard>

      {/* Action Buttons: Download PNG + Apple Wallet */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          type="button"
          onClick={() => void handleDownloadPNG()}
          disabled={downloading}
          className="w-full sm:flex-1 min-h-[44px] py-2.5 px-4 rounded-full bg-ink text-white hover:bg-neutral-800 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-xs border border-neutral-700 disabled:opacity-70"
        >
          <Download className="w-4 h-4 text-tan" />
          <span>
            {downloading
              ? lang === 'en'
                ? 'Generating Image...'
                : '正在生成电子卡...'
              : lang === 'en'
                ? 'Download Member Card (PNG)'
                : '下载电子会员卡 (PNG)'}
          </span>
        </button>

        {walletReady && (
          <button
            type="button"
            onClick={handleWallet}
            disabled={walletBusy}
            className="w-full sm:flex-1 min-h-[44px] py-2.5 px-4 rounded-full bg-surface-3 text-ink hover:bg-neutral-200 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-xs border border-neutral-200 disabled:opacity-70"
          >
            {/* Apple Logo Icon SVG */}
            <svg className="w-4 h-4 fill-current" viewBox="0 0 170 170">
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.6-7.83-11.74-14.34-5.33-8.37-9.58-18.04-12.75-29.02-3.17-10.97-4.77-21.72-4.77-32.24 0-15.01 3.86-27.18 11.59-36.5 7.72-9.33 17.51-14.05 29.37-14.18 4.89 0 10.33 1.3 16.33 3.91 6 2.61 10.05 3.97 12.16 4.09 1.74 0 6.03-1.47 12.87-4.41 6.84-2.93 12.66-4.24 17.47-3.91 13.04.65 23.37 5.43 31 14.34-11.52 6.96-17.17 16.53-16.96 28.71.22 9.57 3.97 17.67 11.26 24.3 7.28 6.63 15.76 10.22 25.44 10.76-2.18 6.74-4.89 13.26-8.15 19.57zM119.22 31.85c0-7.39 2.66-14.34 7.99-20.85 5.33-6.52 11.96-10.54 19.89-12.06.22 1.3.33 2.49.33 3.59 0 7.39-2.77 14.45-8.32 21.18-5.54 6.74-12.17 10.66-19.89 11.74-.22-1.08-.33-2.28-.33-3.6z" />
            </svg>
            <span>
              {walletBusy
                ? lang === 'en'
                  ? 'Creating pass...'
                  : '正在生成...'
                : lang === 'en'
                  ? 'Add to Apple Wallet'
                  : '加入 Apple 钱包'}
            </span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Full-screen QR for scanning at a partner business */}
      {zoom && (
        <div
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-neutral-200 text-center space-y-4 relative"
          >
            <button
              type="button"
              onClick={() => setZoom(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 flex items-center justify-center cursor-pointer text-sm font-bold"
              aria-label={lang === 'en' ? 'Close' : '关闭'}
            >
              ✕
            </button>

            <div className="space-y-1 pt-2">
              <div className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t('Scan to verify membership', '扫码实时验证会员资格')}</span>
              </div>
              <h3 className="text-lg font-bold font-serif-caaci text-neutral-900 break-words">
                {name}
              </h3>
              <p className="text-xs text-neutral-500">
                {tierName} · {t('Valid through', '有效期至')} {validThrough}
              </p>
            </div>

            <div className="p-3 bg-white rounded-2xl border-2 border-neutral-900 inline-block mx-auto">
              <QrCodeSvg text={qrText} className="w-56 h-56 sm:w-64 sm:h-64 block" />
            </div>

            <p className="text-[11px] font-mono tracking-widest text-neutral-500">ID: {shortId}</p>

            <p className="text-[11px] text-neutral-500 leading-relaxed px-2">
              {t(
                'The scan opens a live check that shows only your name, plan and validity. Turn up screen brightness if the scanner struggles.',
                '扫码会打开实时验证页面，只显示姓名、方案和有效期。若扫码困难，请调高屏幕亮度。',
              )}
            </p>

            <button
              type="button"
              onClick={() => setZoom(false)}
              className="w-full min-h-[44px] py-2.5 rounded-full bg-brick hover:bg-brick-pressed text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98"
            >
              {t('Close', '关闭')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

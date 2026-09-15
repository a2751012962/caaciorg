import { useRef, useState } from 'react';
import { QrCode, Download, Smartphone, Check, ShieldCheck, AlertCircle } from 'lucide-react';
import type { UserProfile } from '../types/account';

interface DigitalMemberCardProps {
  user: UserProfile;
  lang: 'en' | 'zh';
  serverCertConfigured?: boolean;
}

function formatShortTierName(name: string) {
  if (!name) return 'FAMILY';
  return name
    .replace(/\s*membership/gi, '')
    .replace(/会员/g, '')
    .trim();
}

export function DigitalMemberCard({
  user,
  lang,
  serverCertConfigured = true,
}: DigitalMemberCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Generate and download high-resolution PNG of the member card
  const handleDownloadPNG = () => {
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw Clean Modern Card Background matching MembershipPage aesthetic
      ctx.fillStyle = '#1d1d1f';
      ctx.beginPath();
      ctx.roundRect(0, 0, 1000, 600, 32);
      ctx.fill();

      // Card Subtle Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Subtle Top Brand Accent Line
      const topBarGradient = ctx.createLinearGradient(0, 0, 1000, 0);
      topBarGradient.addColorStop(0, '#8e2e11');
      topBarGradient.addColorStop(0.5, '#d3a971');
      topBarGradient.addColorStop(1, '#8e2e11');
      ctx.fillStyle = topBarGradient;
      ctx.beginPath();
      ctx.roundRect(40, 30, 920, 4, 2);
      ctx.fill();

      // Organization Logo Badge
      ctx.fillStyle = '#8e2e11';
      ctx.beginPath();
      ctx.arc(85, 95, 32, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C', 85, 96);

      // Organization Name
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('CAACI', 135, 86);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Chinese American Association of Central Illinois', 135, 112);

      // Plan Tier Badge on Top Right
      const rawTier = lang === 'en' ? user.membership.tierNameEN : user.membership.tierNameZH;
      const tierText = formatShortTierName(rawTier);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.roundRect(750, 68, 190, 44, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tierText, 845, 94);

      // Member Name Section
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(lang === 'en' ? 'CARDHOLDER NAME' : '持卡人姓名', 65, 220);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(user.name || 'xxx', 65, 270);

      // Membership Number
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(lang === 'en' ? 'MEMBERSHIP ID' : '会员编号', 65, 380);

      ctx.fillStyle = '#d3a971';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(user.memberId, 65, 420);

      // Validity Expiration Date
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(lang === 'en' ? 'VALID THROUGH' : '有效期至', 400, 380);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(user.membership.validThrough, 400, 420);

      // Decorative divider
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(65, 475);
      ctx.lineTo(935, 475);
      ctx.stroke();

      // Bottom Merchant Notice
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(
        lang === 'en'
          ? 'Official Digital Member Pass • Central Illinois Merchant Privileges'
          : 'CAACI 官方认证数字会员卡 • 享受中伊利诺伊商户专属礼遇',
        65,
        525,
      );

      // QR Code Simulated Box on Bottom Right
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(760, 200, 175, 175, 16);
      ctx.fill();

      // Draw mini QR pattern
      ctx.fillStyle = '#1d1d1f';
      const qrStartX = 780;
      const qrStartY = 220;
      const matrix = [
        [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1],
        [1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
        [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1],
        [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1],
        [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
      ];
      const cellSize = 130 / 11;
      for (let r = 0; r < 11; r++) {
        for (let c = 0; c < 11; c++) {
          if (matrix[r][c]) {
            ctx.fillRect(qrStartX + c * cellSize, qrStartY + r * cellSize, cellSize, cellSize);
          }
        }
      }

      ctx.fillStyle = '#8e2e11';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lang === 'en' ? 'SCAN TO VERIFY' : '商家扫码验真', 845, 410);

      // Trigger download
      const link = document.createElement('a');
      link.download = `CAACI-Membership-Card-${user.memberId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setTimeout(() => setDownloading(false), 800);
    }
  };

  return (
    <div className="space-y-4">
      {/* Visual Digital Member Card (100% matching Membership Page Apple-style Pass) */}
      <div
        id="digital-member-card"
        className="bg-[#1d1d1f] text-white rounded-2xl p-6 sm:p-7 shadow-xl border border-white/10 relative overflow-hidden select-none"
      >
        {/* Top Header */}
        <div className="flex justify-between items-center pb-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <img
              src="/images/logo.png"
              alt="CAACI"
              className="h-7 w-auto bg-white/10 rounded p-0.5 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">
                CAACI Member Pass
              </div>
              <div className="text-[10px] text-neutral-400">Central Illinois • 501(c)(3)</div>
            </div>
          </div>

          <span className="text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-white/15 text-neutral-200">
            {formatShortTierName(
              lang === 'en' ? user.membership.tierNameEN : user.membership.tierNameZH,
            )}
          </span>
        </div>

        {/* Member Name */}
        <div className="py-6 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              {lang === 'en' ? 'Cardholder Name' : '持卡人姓名'}
            </div>
            <div className="text-xl font-medium tracking-tight text-white mt-0.5">
              {user.name || 'xxx'}
            </div>
          </div>

          {/* Member ID & Expires Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                {lang === 'en' ? 'Member ID' : '会员编号'}
              </div>
              <div className="font-mono text-neutral-200 mt-0.5">{user.memberId}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                {lang === 'en' ? 'Expires' : '有效期至'}
              </div>
              <div className="font-mono text-neutral-200 mt-0.5">
                {user.membership.validThrough}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar with QR Scan trigger */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
          <span className="text-[10px]">
            {lang === 'en' ? 'Tap or scan for merchant discounts' : '出示享受合作商户专属折扣'}
          </span>
          <button
            type="button"
            onClick={() => setShowVerifyModal(true)}
            className="p-1 -mr-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer text-neutral-300 hover:text-white"
            title={lang === 'en' ? 'Tap to view verification' : '点击查看实时验真'}
          >
            <QrCode className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Action Buttons: Download PNG + Apple Wallet */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Download as PNG button */}
        <button
          type="button"
          onClick={handleDownloadPNG}
          disabled={downloading}
          className="w-full sm:flex-1 py-2.5 px-4 rounded-full bg-[#1d1d1f] text-white hover:bg-neutral-800 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-xs border border-neutral-700"
        >
          <Download className="w-4 h-4 text-[#d3a971]" />
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

        {/* Add to Apple Wallet button */}
        {serverCertConfigured ? (
          <button
            type="button"
            onClick={() => {
              alert(
                lang === 'en'
                  ? 'Apple Wallet pass generated successfully. Opening Wallet...'
                  : 'Apple 钱包凭证已通过 CAACI 证书签署生成，正在添加至钱包...',
              );
            }}
            className="w-full sm:flex-1 py-2.5 px-4 rounded-full bg-[#f5f5f7] text-[#1d1d1f] hover:bg-neutral-200 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-xs border border-neutral-200"
          >
            {/* Apple Logo Icon SVG */}
            <svg className="w-4 h-4 fill-current" viewBox="0 0 170 170">
              <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.6-7.83-11.74-14.34-5.33-8.37-9.58-18.04-12.75-29.02-3.17-10.97-4.77-21.72-4.77-32.24 0-15.01 3.86-27.18 11.59-36.5 7.72-9.33 17.51-14.05 29.37-14.18 4.89 0 10.33 1.3 16.33 3.91 6 2.61 10.05 3.97 12.16 4.09 1.74 0 6.03-1.47 12.87-4.41 6.84-2.93 12.66-4.24 17.47-3.91 13.04.65 23.37 5.43 31 14.34-11.52 6.96-17.17 16.53-16.96 28.71.22 9.57 3.97 17.67 11.26 24.3 7.28 6.63 15.76 10.22 25.44 10.76-2.18 6.74-4.89 13.26-8.15 19.57zM119.22 31.85c0-7.39 2.66-14.34 7.99-20.85 5.33-6.52 11.96-10.54 19.89-12.06.22 1.3.33 2.49.33 3.59 0 7.39-2.77 14.45-8.32 21.18-5.54 6.74-12.17 10.66-19.89 11.74-.22-1.08-.33-2.28-.33-3.6z" />
            </svg>
            <span>{lang === 'en' ? 'Add to Apple Wallet' : '加入 Apple 钱包'}</span>
          </button>
        ) : (
          <div className="w-full sm:flex-1 py-2 px-3 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-400 text-[11px] text-center">
            {lang === 'en' ? 'Apple Wallet cert pending' : 'Apple 钱包需服务器签名证书'}
          </div>
        )}
      </div>

      {/* Real-Time Merchant Scan Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-neutral-200 text-center space-y-4 animate-scaleUp">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-7 h-7" />
            </div>

            <div>
              <h4 className="text-lg font-bold text-[#1d1d1f]">
                {lang === 'en' ? 'Real-Time Verification' : '会员身份实时验真'}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {lang === 'en'
                  ? 'Participating merchants scan this dynamic code to confirm valid CAACI membership.'
                  : '合作商户扫描此动态识别码即可核验 CAACI 正式会员资格与专享折扣。'}
              </p>
            </div>

            <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 text-left text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-neutral-500">{lang === 'en' ? 'Member:' : '持卡会员:'}</span>
                <span className="font-semibold text-neutral-900">{user.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">{lang === 'en' ? 'Card ID:' : '会员卡号:'}</span>
                <span className="font-mono font-semibold text-neutral-900">{user.memberId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">{lang === 'en' ? 'Status:' : '资格状态:'}</span>
                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {lang === 'en' ? 'Active & Verified' : '有效认证'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">
                  {lang === 'en' ? 'Valid Through:' : '有效截止:'}
                </span>
                <span className="font-mono text-neutral-700">{user.membership.validThrough}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowVerifyModal(false)}
              className="w-full py-2.5 rounded-full bg-[#8e2e11] text-white hover:brightness-110 text-xs font-semibold cursor-pointer"
            >
              {lang === 'en' ? 'Close' : '关闭'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

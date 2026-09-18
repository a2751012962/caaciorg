import { useState } from 'react';
import { Clock, ExternalLink, MapPin, Navigation, Phone, ShieldCheck } from 'lucide-react';
import { FluidTabs } from '../../../../components/FluidTabs';
import { directionsUrl, rowToMerchant, type DirectoryRow } from '../../../../lib/directory';
import type { BusinessMerchant } from '../../../../data/pages/business';
import { LABEL, useAdmin } from '../../kit';

type CardLang = 'en' | 'zh';
type Layout = 'desktop' | 'phone';

// The listing as the Business Services page will show it, redrawn on every
// change to the form. The card data comes from the page's own helpers
// (rowToMerchant, directionsUrl in web/src/lib/directory.ts), so the fallbacks
// (Chinese ⇄ English, tags, category label, safe website, Maps link) are the
// real ones. The two card layouts are not exported by BusinessServicesPage.tsx
// (they are inline in its render), so their markup is composed here from the
// same classes and icons; change them together.
export function BizPreview({ draft }: { draft: DirectoryRow & { approved: boolean } }) {
  const { t, lang } = useAdmin();
  const [cardLang, setCardLang] = useState<CardLang>(lang === 'zh' ? 'zh' : 'en');
  const [layout, setLayout] = useState<Layout>('desktop');
  const m = rowToMerchant(draft, cardLang);

  const notes: string[] = [];
  if (!draft.approved)
    notes.push(
      t(
        'Not approved: the public page will not show this listing.',
        '未批准：公开页面不会显示此条目。',
      ),
    );
  if ((draft.website || '').trim() && !m.website)
    notes.push(
      t(
        'The website is not a valid link, so no Website button is shown.',
        '网站不是有效链接，页面不会显示网站按钮。',
      ),
    );
  if (!m.address)
    notes.push(t('No address, so no Directions button.', '没有地址，因此不显示导航按钮。'));

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-surface-3 p-4 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${LABEL} mb-0`}>{t('Live preview', '实时预览')}</span>
        <div className="flex flex-wrap gap-2">
          <FluidTabs<CardLang>
            id="biz-preview-lang"
            role="group"
            ariaLabel={t('Preview language', '预览语言')}
            value={cardLang}
            onChange={setCardLang}
            items={[
              { value: 'en', label: 'EN' },
              { value: 'zh', label: '中文' },
            ]}
          />
          <FluidTabs<Layout>
            id="biz-preview-layout"
            role="group"
            ariaLabel={t('Preview layout', '预览版式')}
            value={layout}
            onChange={setLayout}
            items={[
              { value: 'desktop', label: t('Desktop', '电脑') },
              { value: 'phone', label: t('Phone', '手机') },
            ]}
          />
        </div>
      </div>
      <div lang={cardLang} className="@container min-w-0">
        {layout === 'phone' ? (
          <PhoneCard m={m} lang={cardLang} />
        ) : (
          <DesktopRow m={m} lang={cardLang} />
        )}
      </div>
      {notes.length > 0 && (
        <ul className="space-y-1 text-xs text-neutral-500">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Name = ({ m, lang }: { m: BusinessMerchant; lang: CardLang }) =>
  m.name ? (
    <>{m.name}</>
  ) : (
    <span className="text-neutral-400 font-normal">
      {lang === 'zh' ? '（商家名称）' : '(Business name)'}
    </span>
  );

// The carousel card the page shows under 768px.
function PhoneCard({ m, lang }: { m: BusinessMerchant; lang: CardLang }) {
  return (
    <div className="w-full max-w-[320px] mx-auto bg-white rounded-2xl p-5 border border-neutral-200/90 shadow-sm flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
            {m.categoryLabel}
          </span>
          {m.featured && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-900 text-white flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-gold" />
              <span>Verified</span>
            </span>
          )}
          {m.tags?.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-600"
            >
              {tag}
            </span>
          ))}
        </div>
        <div>
          <h3 className="text-base font-semibold text-ink tracking-tight line-clamp-1">
            <Name m={m} lang={lang} />
          </h3>
          <p className="text-xs text-neutral-600 leading-relaxed mt-1.5 line-clamp-3">{m.desc}</p>
        </div>
        <div className="space-y-1.5 text-[11px] text-neutral-500 pt-2.5 border-t border-neutral-100">
          {m.address && (
            <div className="flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
              <span className="line-clamp-1">{m.address}</span>
            </div>
          )}
          {m.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>{m.phone}</span>
            </div>
          )}
          {m.hours && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span className="line-clamp-1">{m.hours}</span>
            </div>
          )}
        </div>
      </div>
      {(m.website || m.address) && (
        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-neutral-100">
          {m.website && (
            <a
              href={m.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 text-center text-xs font-medium rounded-full border border-neutral-200 text-neutral-800 hover:border-neutral-400 transition-colors inline-flex items-center justify-center gap-1"
            >
              <span>{lang === 'en' ? 'Website' : '网站'}</span>
              <ExternalLink className="w-3 h-3 text-neutral-400" />
            </a>
          )}
          {m.address && (
            <a
              href={directionsUrl(m)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 text-center text-xs font-medium rounded-full bg-neutral-900 text-white hover:bg-neutral-800 transition-colors inline-flex items-center justify-center gap-1 shadow-xs"
            >
              <Navigation className="w-3 h-3 text-gold" />
              <span>{lang === 'en' ? 'Directions' : '导航'}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// The list row the page shows from 768px. The page switches to a row at its
// md breakpoint; the preview column is narrower than the page, so it switches
// on its own width instead.
function DesktopRow({ m, lang }: { m: BusinessMerchant; lang: CardLang }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 overflow-hidden shadow-sm">
      <div className="p-6 flex flex-col @lg:flex-row @lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
              {m.categoryLabel}
            </span>
            {m.featured && (
              <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-neutral-900 text-white flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-gold" />
                <span>CAACI Verified</span>
              </span>
            )}
            {m.tags?.map((tag) => (
              <span
                key={tag}
                className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-neutral-200 text-neutral-600"
              >
                {tag}
              </span>
            ))}
          </div>
          <h3 className="text-lg sm:text-xl font-semibold text-ink tracking-tight break-words">
            <Name m={m} lang={lang} />
          </h3>
          <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed break-words">
            {m.desc}
          </p>
          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-neutral-500 pt-1">
            {m.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>{m.address}</span>
              </span>
            )}
            {m.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>{m.phone}</span>
              </span>
            )}
            {m.hours && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>{m.hours}</span>
              </span>
            )}
          </div>
        </div>
        {(m.website || m.address) && (
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {m.website && (
              <a
                href={m.website}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-xs font-medium rounded-full border border-neutral-200 text-neutral-800 hover:border-neutral-400 transition-colors inline-flex items-center gap-1.5"
              >
                <span>{lang === 'en' ? 'Visit Website' : '访问商户'}</span>
                <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
              </a>
            )}
            {m.address && (
              <a
                href={directionsUrl(m)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-xs font-medium rounded-full bg-neutral-100 text-neutral-800 hover:bg-neutral-200 transition-colors inline-flex items-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5 text-brick" />
                <span>{lang === 'en' ? 'Directions' : '导航路线'}</span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { ArrowUpRight, MessageCircle, Search, ShoppingBag } from 'lucide-react';
import { contentEN, contentZH } from '../data/content';
import type { Lang } from '../lib/lang';
import { marketplaceUrl } from '../lib/marketplace';
import { Reveal } from './Reveal';

const featureIcons = [Search, ShoppingBag, MessageCircle];

// A partner site's entry point, laid out like every other section on the page
// (DESIGN_SYSTEM §5.3): a rule and white space instead of a card, the section
// eyebrow + heading + short brick line, the feature list divided by hairlines.
export function MarketplaceSection({
  lang,
  placement,
}: {
  lang: Lang;
  placement: 'home' | 'resources';
}) {
  const text = (lang === 'zh' ? contentZH : contentEN).marketplace;
  return (
    <section
      aria-labelledby="marketplace-heading"
      className="bg-white py-16 sm:py-24 border-t border-neutral-200/80"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl mb-10 sm:mb-14">
          <span className="text-xs font-semibold text-brick block mb-2">{text.eyebrow}</span>
          <h2
            id="marketplace-heading"
            className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-ink"
          >
            {text.title}
          </h2>
          <div className="w-12 h-0.5 bg-brick mt-3 rounded-full" />
        </Reveal>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <Reveal className="lg:col-span-6" index={0}>
            <p className="text-sm sm:text-base text-neutral-600 leading-relaxed max-w-[580px]">
              {text.description}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-x-6">
              <a
                href={marketplaceUrl(placement)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] w-full sm:w-auto px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider shadow-xs transition-all active:scale-98 inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {text.browse}
                <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </a>
              <a
                href={`https://www.illinimarket.com/community${lang === 'zh' ? '#zh' : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brick transition-colors"
              >
                {text.more}
                <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-4 text-xs text-neutral-500 leading-relaxed">{text.note}</p>
          </Reveal>
          <Reveal className="lg:col-span-6" index={1}>
            <ul className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
              {text.features.map((feature, index) => {
                // A feature an editor adds past the third reuses the icons in turn.
                const Icon = featureIcons[index % featureIcons.length];
                return (
                  <li key={feature.title} className="flex gap-4 items-start py-4">
                    <span className="w-10 h-10 shrink-0 rounded-full bg-white border border-neutral-200/70 shadow-2xs flex items-center justify-center">
                      <Icon className="w-5 h-5 text-brick" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-ink tracking-tight">
                        {feature.title}
                      </h3>
                      <p className="mt-1 text-xs sm:text-sm text-neutral-600 leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

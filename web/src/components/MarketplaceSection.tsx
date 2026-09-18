import { ArrowUpRight, MessageCircle, Search, ShoppingBag } from 'lucide-react';
import type { Lang } from '../lib/lang';
import { marketplaceUrl } from '../lib/marketplace';
import { Reveal } from './Reveal';

const copy = {
  en: {
    eyebrow: 'For neighbors and students',
    title: 'Buy, sell, and find what you need nearby.',
    description:
      'A desk for your new place. A bike you no longer use. Illini Market brings for-sale and wanted posts together for UIUC and Champaign–Urbana, so useful finds do not get lost in separate group chats.',
    browse: 'Explore Illini Market',
    more: 'Community & contact',
    language: 'English & 中文',
    features: [
      { title: 'Find it', description: 'Search listings and browse by category.' },
      { title: 'Post it', description: 'Sell an item or say what you are looking for.' },
      { title: 'Talk it through', description: 'Ask about condition and arrange pickup in chat.' },
    ],
    note: 'Opens a separate website. Posting and messaging use your Illini Market account.',
  },
  zh: {
    eyebrow: '面向本地居民与同学',
    title: '附近的闲置，和你正在找的东西。',
    description:
      '刚搬家想找张桌子，或是有辆闲置自行车？Illini 集市把 UIUC 和香槟–厄巴纳的出售、求购信息放在一起，不用再挨个翻找不同的微信群。',
    browse: '逛逛 Illini 集市',
    more: '社区与联系',
    language: '中文 & English',
    features: [
      { title: '找一找', description: '搜索商品，按分类浏览附近的闲置。' },
      { title: '发一条', description: '发布出售，或说说你想求购什么。' },
      { title: '聊清楚', description: '私信确认成色、尺寸，再约好取货。' },
    ],
    note: '将在独立网站打开；发布和私信使用 Illini 集市账号。',
  },
};

const featureIcons = [Search, ShoppingBag, MessageCircle];

export function MarketplaceSection({
  lang,
  placement,
}: {
  lang: Lang;
  placement: 'home' | 'resources';
}) {
  const text = copy[lang];
  return (
    <section aria-labelledby="marketplace-heading" className="bg-white py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="rounded-3xl border border-neutral-200/80 bg-surface-2 p-6 sm:p-10 lg:p-12">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold font-poppins">
            <span className="text-brick">{text.eyebrow}</span>
            <span className="text-neutral-600">{text.language}</span>
          </div>
          <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-sm font-semibold text-brick font-poppins">
                Illini Market · Illini 集市
              </p>
              <h2
                id="marketplace-heading"
                className="mt-3 text-2xl sm:text-3xl text-ink tracking-tight"
              >
                {text.title}
              </h2>
              <p className="mt-4 text-sm sm:text-base text-neutral-600 font-poppins leading-relaxed">
                {text.description}
              </p>
              <div className="mt-6 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:gap-x-5 font-poppins">
                <a
                  href={marketplaceUrl(placement)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brick px-6 py-3 text-sm font-semibold uppercase tracking-wider text-white hover:bg-brick-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick"
                >
                  {text.browse}
                  <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a>
                <a
                  href={`https://www.illinimarket.com/community${lang === 'zh' ? '#zh' : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 text-sm text-brick underline underline-offset-4 hover:text-maroon focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brick"
                >
                  {text.more}
                  <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </a>
              </div>
              <p className="mt-4 text-xs text-neutral-500 font-poppins leading-relaxed">
                {text.note}
              </p>
            </div>
            <ul className="space-y-5 font-poppins">
              {text.features.map((feature, index) => {
                const Icon = featureIcons[index];
                return (
                  <li key={feature.title} className="flex gap-4 items-start">
                    <span className="shrink-0 rounded-xl bg-white border border-neutral-200 p-3 text-brick">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-base font-semibold font-poppins text-ink">
                        {feature.title}
                      </h3>
                      <p className="mt-1 text-sm text-neutral-600 leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

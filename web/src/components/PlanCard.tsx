import { motion } from 'motion/react';
import { Check, Coins } from 'lucide-react';
import { hoverLift, hoverScale, inView, rise, riseFrom, tap } from '../lib/motion';
import { usd } from '../lib/shared';
import { cardTotal, isFree, money, tierName, type Tier } from '../lib/tiers';
import { membershipPageDataEN, membershipPageDataZH, type TierCopy } from '../data/pagesContent';

type Lang = 'en' | 'zh';

// The period and benefit lines a plan card shows. Lines saved in the admin
// Plans tab win over the built-in ones in data/pages/membership.ts; a plan with
// neither shows its description.
export function planCopy(tier: Tier, lang: Lang): TierCopy {
  const data = lang === 'en' ? membershipPageDataEN : membershipPageDataZH;
  const copy = (data.tiers as Partial<Record<string, TierCopy>>)[tier.id];
  const perYear = lang === 'zh' ? '每年' : 'per year';
  const live = lang === 'zh' ? tier.features_zh : tier.features;
  if (live?.length) return { period: perYear, ...copy, features: live };
  if (copy) return copy;
  const desc = lang === 'zh' ? tier.description_zh || tier.description : tier.description;
  return { period: perYear, features: desc ? [desc] : [] };
}

interface PlanCardProps {
  tier: Tier;
  lang: Lang;
  /** Position in the row; staggers the entrance. */
  index?: number;
  selected?: boolean;
  isMyPlan?: boolean;
  /** 华协币 this plan grants each membership year; 0 or absent shows no line. */
  tokens?: number;
  onSelect?: () => void;
}

// One plan on /membership/, also drawn by the admin edit preview (PlanPreview).
export function PlanCard({
  tier,
  lang,
  index = 0,
  selected = false,
  isMyPlan = false,
  tokens = 0,
  onSelect,
}: PlanCardProps) {
  const t = (en: string, zh: string) => (lang === 'en' ? en : zh);
  const copy = planCopy(tier, lang);
  const tierIsFree = isFree(tier);
  const isPopular = copy.isPopular || tier.id === 'family';

  return (
    <motion.div
      initial={riseFrom}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={inView}
      transition={rise(index * 0.1)}
      whileHover={hoverLift}
      whileTap={tap}
      className={`w-[82vw] max-w-[310px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-white rounded-2xl p-6 sm:p-7 border transition-all duration-300 flex flex-col justify-between relative ${
        selected
          ? 'border-ink shadow-lg ring-1 ring-ink'
          : 'border-neutral-200/80 shadow-xs hover:border-neutral-300'
      }`}
    >
      {isPopular && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute -top-3 left-6 z-20 bg-ink text-white text-[10px] font-semibold px-3 py-0.5 rounded-full shadow-md whitespace-nowrap"
        >
          {lang === 'en' ? 'Recommended' : '推荐首选'}
        </motion.div>
      )}

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-ink tracking-tight">{tierName(tier, lang)}</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {tierIsFree ? t('Free', '免费') : money(tier.price_cents)}
            </span>
            <span className="text-xs text-neutral-400">/ {copy.period}</span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500 leading-snug">
            {tierIsFree
              ? t('No card needed', '无需付款')
              : t(
                  `${usd(cardTotal(tier))} by card, incl. 3.5% fee`,
                  `刷卡合计 ${usd(cardTotal(tier))}（含 3.5% 手续费）`,
                )}
          </div>
        </div>

        {/* What the plan puts in the member's wallet. It sits above the benefit
            lines rather than among them because it is a number, and because the
            admin's own benefit lines must not be able to contradict it. */}
        {tokens > 0 && (
          <div className="flex items-start gap-2 pt-4 border-t border-neutral-100 text-xs font-medium text-brick">
            <Coins className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {t(
                `${tokens.toLocaleString('en-US')} CAACI Tokens each year`,
                `每年赠送 ${tokens.toLocaleString('en-US')} 华协币`,
              )}
            </span>
          </div>
        )}

        <ul className={`space-y-2.5 pt-4 ${tokens > 0 ? '' : 'border-t border-neutral-100'}`}>
          {copy.features.map((feat, fIdx) => (
            <li
              key={fIdx}
              className="flex items-start gap-2.5 text-xs text-neutral-600 leading-normal"
            >
              <Check className="w-3.5 h-3.5 text-ink shrink-0 mt-0.5" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-6 mt-6 border-t border-neutral-100">
        <motion.button
          whileHover={hoverScale}
          whileTap={tap}
          type="button"
          onClick={onSelect}
          className={`w-full py-2.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 cursor-pointer ${
            selected ? 'bg-ink text-white shadow-sm' : 'bg-surface-3 text-ink hover:bg-neutral-200'
          }`}
        >
          {isMyPlan
            ? t('Your current plan ✓', '当前方案 ✓')
            : selected
              ? t('Selected ✓', '已选择 ✓')
              : t('Select Plan', '选择此方案')}
        </motion.button>
      </div>
    </motion.div>
  );
}

import { useState } from 'react';
import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import {
  Play,
  ExternalLink,
  Users,
  HeartHandshake,
  Award,
  ChevronRight,
  ArrowRight,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { aboutDataEN, aboutDataZH } from '../data/pagesContent';
import { Reveal } from '../components/Reveal';

interface AboutPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function AboutPage({ content, lang, onOpenModal, onNavigate }: AboutPageProps) {
  const data = lang === 'en' ? aboutDataEN : aboutDataZH;
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);

  return (
    <div className="bg-white min-h-screen text-ink font-sans antialiased selection:bg-neutral-200">
      {/* 1. Clean Subpage Parallax Header */}
      <SubpageHero
        title={data.title}
        subtitle={data.subtitle}
        bgImage="/images/about-team.jpg"
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="about"
      />

      {/* 2. Apple-Style Mission Section (Generous Negative Space & Editorial Typography) */}
      <section className="py-16 sm:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-b border-neutral-200/80">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left: Mission & Story */}
          <Reveal from="left" className="lg:col-span-7 space-y-6">
            <span className="text-xs font-semibold text-brick block">{data.missionTitle}</span>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink leading-snug">
              “{data.missionText}”
            </h2>

            <p className="text-base sm:text-lg text-neutral-600 leading-relaxed max-w-2xl pt-2">
              {lang === 'en'
                ? 'Since 2000, the Chinese American Association of Central Illinois has served as the anchor civic institution connecting students, researchers, families, and business owners throughout Champaign, Urbana, Savoy, and surrounding counties.'
                : '自 2000 年创立以来，中伊利诺伊华人协会（CAACI）始终是凝聚香槟、厄巴纳、萨沃伊及周边各郡学者、留学生、华人家庭和创业者的核心纽带与公益家园。'}
            </p>

            <div className="pt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('membership')}
                className="px-5 py-2.5 rounded-full bg-ink text-white text-xs font-medium tracking-wide hover:bg-neutral-800 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>{lang === 'en' ? 'Join CAACI Today' : '加入华协大家庭'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenModal('volunteer')}
                className="px-5 py-2.5 rounded-full border border-neutral-300 text-neutral-800 text-xs font-medium tracking-wide hover:border-neutral-800 transition-colors cursor-pointer"
              >
                {lang === 'en' ? 'Become a Volunteer' : '成为华协义工'}
              </button>
            </div>
          </Reveal>

          {/* Right: Authentic Photograph (Crisp Apple Hardware-Style Frame) */}
          <Reveal from="right" className="lg:col-span-5">
            <div className="relative rounded-2xl overflow-hidden border border-neutral-200/90 shadow-sm bg-neutral-100 group">
              <img
                src="/images/about-team.jpg"
                alt="CAACI Team & Community"
                className="w-full h-[340px] sm:h-[400px] object-cover transition-transform duration-700 group-hover:scale-105"
                onError={(e) => {
                  e.currentTarget.src = '/images/about-group.jpg';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex items-end p-6">
                <div className="text-white space-y-0.5">
                  <span className="text-[11px] text-neutral-300 font-medium block">
                    {lang === 'en' ? 'Leadership & Community' : '华协理事会与义工团队'}
                  </span>
                  <div className="text-base font-semibold text-white">CAACI Central Illinois</div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 3. Apple-Style Core Values (Clean 3-Column Columns with Hairline Borders) */}
      <section className="py-16 sm:py-24 bg-surface-2 border-b border-neutral-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl mb-14">
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Our Principles' : '核心价值观'}
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {data.valuesTitle}
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {data.values.map((val, idx) => (
              <Reveal
                key={idx}
                index={idx}
                className="bg-white rounded-2xl p-8 border border-neutral-200/80 shadow-sm flex flex-col justify-between space-y-6"
              >
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center text-ink">
                    {idx === 0 && <Users className="w-5 h-5" />}
                    {idx === 1 && <HeartHandshake className="w-5 h-5" />}
                    {idx === 2 && <Award className="w-5 h-5" />}
                  </div>

                  <h3 className="text-xl font-semibold tracking-tight text-ink">{val.title}</h3>

                  <p className="text-sm text-neutral-600 leading-relaxed">{val.desc}</p>
                </div>

                <div className="pt-4 border-t border-neutral-100 flex items-center gap-2 text-xs font-medium text-neutral-400">
                  <ShieldCheck className="w-4 h-4 text-brick" />
                  <span>Value 0{idx + 1}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Apple-Style Action / Programs Grid (实现途径与活动开展) */}
      <section className="py-16 sm:py-24 bg-white border-b border-neutral-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl mb-12">
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Community Action' : '实现途径与活动开展'}
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {data.howWeDoItTitle}
            </h2>
            <p className="mt-4 text-base text-neutral-600 leading-relaxed">{data.howWeDoItText}</p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Reveal
              index={0}
              className="p-6 rounded-2xl bg-surface-3 border border-black/[0.04] space-y-2"
            >
              <span className="text-[11px] font-semibold text-brick">
                {lang === 'en' ? 'Annual Celebration' : '千人盛宴'}
              </span>
              <h4 className="text-base font-semibold text-ink">
                {lang === 'en' ? 'Spring Festival Gala' : '农历新春晚会'}
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {lang === 'en'
                  ? 'Our signature 1,000+ guest theatrical banquet featuring traditional arts, student performances, and cultural heritage.'
                  : '香槟地区规模最大、历史最悠久的千人新春盛会，融汇传统中华歌舞艺术与名家联欢。'}
              </p>
            </Reveal>

            <Reveal
              index={1}
              className="p-6 rounded-2xl bg-surface-3 border border-black/[0.04] space-y-2"
            >
              <span className="text-[11px] font-semibold text-brick">
                {lang === 'en' ? 'Folk Heritage' : '传统民俗'}
              </span>
              <h4 className="text-base font-semibold text-ink">
                {lang === 'en' ? 'Dragon Boat Gathering' : '端午民俗传统聚会'}
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {lang === 'en'
                  ? 'Handmade zongzi workshops, family picnic games, and folk celebration bringing all generations together.'
                  : '手作香粽品鉴、传统香囊制作与亲子草坪野餐会，传承中华传统端午文化。'}
              </p>
            </Reveal>

            <Reveal
              index={2}
              className="p-6 rounded-2xl bg-surface-3 border border-black/[0.04] space-y-2"
            >
              <span className="text-[11px] font-semibold text-brick">
                {lang === 'en' ? 'Autumn Harvest' : '游园盛会'}
              </span>
              <h4 className="text-base font-semibold text-ink">
                {lang === 'en' ? 'Mid-Autumn Lantern Festival' : '中秋文化游园灯会'}
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {lang === 'en'
                  ? 'Artisan mooncake tastings, riddle games, lantern displays, and poetry recitations beneath the harvest moon.'
                  : '赏月品茗、品味手工酥皮月饼、诗词吟诵与非遗灯谜游园，共庆花好月圆。'}
              </p>
            </Reveal>

            <Reveal
              index={3}
              className="p-6 rounded-2xl bg-surface-3 border border-black/[0.04] space-y-2"
            >
              <span className="text-[11px] font-semibold text-brick">
                {lang === 'en' ? 'Civic & Professional' : '政商与求职'}
              </span>
              <h4 className="text-base font-semibold text-ink">
                {lang === 'en' ? 'Career Fairs & Seminars' : '全州招聘会与法税论坛'}
              </h4>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {lang === 'en'
                  ? 'Illinois State Government job fairs, bilingual tax workshops, immigrant legal aid, and youth mentor forums.'
                  : '联合伊利诺伊州政府举办招聘会、青年创业导师研讨会及双语法律税务专题讲座。'}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 5. Apple Theater Video Showcase (Sleek Obsidian Cinema Frame, No Cheesy Gradients) */}
      <section className="py-16 sm:py-24 bg-ink-deep text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-10 border-b border-white/10 mb-10">
            <div className="space-y-2 max-w-2xl">
              <span className="text-xs font-semibold text-gold block">
                {lang === 'en' ? 'Official Video' : '官方回顾视频'}
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white">
                {data.yearInReviewTitle}
              </h2>
              <p className="text-sm text-neutral-400">
                {lang === 'en'
                  ? 'Relive our community milestones, cultural galas, youth achievements, and fellowship across Central Illinois.'
                  : '回顾过去一年华协举办的重大盛典、文化传承、社区互助与温馨瞬间。'}
              </p>
            </div>

            <div className="shrink-0">
              <a
                href={`https://youtu.be/${data.yearInReviewVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 rounded-full bg-white text-ink hover:bg-neutral-200 text-xs font-medium tracking-wide transition-colors inline-flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-ink" />
                <span>{lang === 'en' ? 'Watch on YouTube' : '在 YouTube 观看'}</span>
                <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
              </a>
            </div>
          </Reveal>

          {/* Minimalist Apple Cinema Frame */}
          <Reveal index={1} className="max-w-5xl mx-auto">
            <div className="relative rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">
              {!isPlayingVideo ? (
                <div
                  className="relative aspect-video w-full bg-cover bg-center flex items-center justify-center group cursor-pointer"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%), url('https://img.youtube.com/vi/${data.yearInReviewVideoId}/maxresdefault.jpg')`,
                  }}
                  onClick={() => setIsPlayingVideo(true)}
                >
                  <button
                    type="button"
                    aria-label="Play video"
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/90 text-ink flex items-center justify-center shadow-lg group-hover:scale-105 group-hover:bg-white transition-all backdrop-blur-sm cursor-pointer"
                  >
                    <Play className="w-6 h-6 fill-ink translate-x-0.5" />
                  </button>

                  <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between text-xs text-white/80">
                    <span className="font-medium">{data.yearInReviewTitle}</span>
                    <span className="text-white/60">
                      {lang === 'en' ? 'Click to play in-page' : '点击直接播放'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative aspect-video w-full">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${data.yearInReviewVideoId}?autoplay=1&rel=0`}
                    title="CAACI Year in Review"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-neutral-400 px-1">
              <span>
                {lang === 'en'
                  ? 'Produced by CAACI Media & Publicity Group'
                  : '由中伊利诺伊州华人协会（CAACI）宣传部摄制制作'}
              </span>
              <a
                href={`https://youtu.be/${data.yearInReviewVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-300 hover:text-white inline-flex items-center gap-1"
              >
                <span>youtu.be/{data.yearInReviewVideoId}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 6. Apple-Style Leadership Directory (管理架构与理事会名录) */}
      <section className="py-16 sm:py-24 bg-surface-2 border-b border-neutral-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl mb-14">
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Leadership' : '协会治理'}
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {data.managementTitle}
            </h2>
            <p className="mt-2 text-sm text-neutral-500">{data.managementSubtitle}</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {data.team.map((member, idx) => (
              <Reveal
                key={idx}
                index={idx}
                className="bg-white p-7 rounded-2xl border border-neutral-200/80 shadow-sm flex flex-col justify-between space-y-4"
              >
                <div>
                  <span className="text-[11px] font-semibold text-brick block mb-1">
                    {member.role}
                  </span>
                  <h4 className="text-lg font-semibold text-ink">{member.name}</h4>
                  <p className="text-xs text-neutral-600 mt-2 leading-relaxed">{member.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Apple-Style Past Presidents Roster (历届会长) */}
      <section className="py-16 sm:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl mb-12">
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Heritage & Honor' : '光荣传承'}
            </span>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
              {data.pastPresidentsTitle}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-neutral-500">
              {data.pastPresidentsSubtitle}
            </p>
          </Reveal>

          {/* Clean minimal grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {data.pastPresidents.map((p, idx) => (
              <Reveal
                key={idx}
                from="up-sm"
                index={idx}
                className="p-4 rounded-xl border border-neutral-200/80 bg-surface-2 hover:bg-neutral-100 transition-colors"
              >
                <span className="text-xs font-semibold text-neutral-400 block font-mono">
                  {p.year}
                </span>
                <span className="font-semibold text-sm text-ink mt-0.5 block">{p.name}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <ContactSection content={content} />
    </div>
  );
}

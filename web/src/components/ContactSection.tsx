import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Send, CheckCircle, Mail, MapPin } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CAACIContent } from '../data/content';
import { api } from '../lib/api';

gsap.registerPlugin(ScrollTrigger);

interface ContactSectionProps {
  content: CAACIContent;
  /** Puts `message` in the message box (e.g. feedback on a past event); a new `key` applies it again. */
  prefill?: { message: string; key: number };
}

const EMPTY_FORM = { name: '', email: '', phone: '', message: '' };

// Sends to /api/contact, which stores the message in form_submissions and
// emails the CAACI inbox with the sender as reply-to.
export function ContactSection({ content, prefill }: ContactSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!prefill) return;
    setStatus('idle');
    setErrorMessage('');
    setFormData((prev) => ({ ...prev, message: prefill.message }));
    const timer = window.setTimeout(() => messageRef.current?.focus({ preventScroll: true }), 500);
    return () => window.clearTimeout(timer);
  }, [prefill]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // 左右侧入场: Left Form card enters from Left
      if (leftColRef.current) {
        gsap.fromTo(
          leftColRef.current,
          { x: -70, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 80%',
              toggleActions: 'play none none reverse',
            },
          },
        );

        // 错峰入场: Form inputs stagger in
        gsap.fromTo(
          leftColRef.current.querySelectorAll('.contact-input-field'),
          { y: 20, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            stagger: 0.08,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 75%',
              toggleActions: 'play none none reverse',
            },
          },
        );
      }

      // 左右侧入场: Right info card enters from Right
      if (rightColRef.current) {
        gsap.fromTo(
          rightColRef.current.children,
          { x: 70, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            stagger: 0.15,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 80%',
              toggleActions: 'play none none reverse',
            },
          },
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, [content]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const name = formData.name.trim();
    const email = formData.email.trim();
    const message = formData.message.trim();
    if (!name || !email || !message) {
      setErrorMessage(content.contact.requiredError);
      return;
    }

    setErrorMessage('');
    setStatus('sending');
    const {
      ok,
      status: code,
      data,
    } = await api('/api/contact', {
      name,
      email,
      phone: formData.phone.trim(),
      message,
      _hp: honeypot,
    });
    if (ok) {
      setStatus('success');
      setFormData(EMPTY_FORM);
      return;
    }
    setStatus('idle');
    setErrorMessage(
      code === 0
        ? content.contact.networkError
        : code < 500 && data.error
          ? data.error
          : content.contact.sendFailed,
    );
  };

  return (
    <section
      ref={sectionRef}
      id="contact"
      className="relative py-20 md:py-28 bg-[#fbf9f6] border-t border-neutral-200/80 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          {/* Left Column (左右侧入场 - Enters from Left): Authentic Contact Form Card matching /membership/ */}
          <div
            ref={leftColRef}
            className="lg:col-span-6 bg-white p-8 sm:p-10 rounded-2xl border border-neutral-200/80 shadow-xs will-change-transform"
          >
            <div className="mb-8 text-center">
              <span className="text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block mb-1">
                Get In Touch · 联络我们
              </span>
              <h2
                className="text-2xl sm:text-3xl font-semibold text-[#1d1d1f] tracking-tight font-serif-caaci"
                style={{ fontFamily: "'Playfair Display', 'Noto Serif SC', Georgia, serif" }}
              >
                {content.contact.heading}
              </h2>
            </div>

            {status === 'success' ? (
              <div
                role="status"
                className="p-8 bg-emerald-50 border border-emerald-200/80 rounded-2xl text-center space-y-3 animate-in fade-in"
              >
                <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
                <h4 className="font-semibold text-emerald-900 font-poppins text-lg">
                  {content.contact.sentTitle}
                </h4>
                <p className="text-emerald-700 font-poppins text-xs sm:text-sm leading-relaxed">
                  {content.contact.sentSuccess}
                </p>
                <button
                  type="button"
                  onClick={() => setStatus('idle')}
                  className="mt-4 inline-block px-6 py-2.5 text-xs font-medium text-emerald-900 bg-white border border-emerald-300 rounded-full hover:bg-emerald-100 transition-colors cursor-pointer"
                >
                  {content.contact.sendAnother}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="relative space-y-4">
                {errorMessage && (
                  <div
                    role="alert"
                    className="p-3 bg-red-50 text-red-700 text-xs font-medium rounded-xl border border-red-200"
                  >
                    {errorMessage}
                  </div>
                )}

                <div className="contact-input-field">
                  <label htmlFor="contact-name" className="sr-only">
                    {content.contact.namePlaceholder}
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={`${content.contact.namePlaceholder} *`}
                    className="w-full px-4 py-3 text-sm rounded-xl bg-[#fbfbfd] border border-neutral-200/80 text-[#1d1d1f] placeholder-neutral-400 focus:outline-none focus:border-[#1d1d1f] focus:ring-1 focus:ring-[#1d1d1f] focus:bg-white font-poppins transition-all"
                  />
                </div>

                <div className="contact-input-field">
                  <label htmlFor="contact-email" className="sr-only">
                    {content.contact.emailPlaceholder}
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder={`${content.contact.emailPlaceholder} *`}
                    className="w-full px-4 py-3 text-sm rounded-xl bg-[#fbfbfd] border border-neutral-200/80 text-[#1d1d1f] placeholder-neutral-400 focus:outline-none focus:border-[#1d1d1f] focus:ring-1 focus:ring-[#1d1d1f] focus:bg-white font-poppins transition-all"
                  />
                </div>

                <div className="contact-input-field">
                  <label htmlFor="contact-phone" className="sr-only">
                    {content.contact.phonePlaceholder}
                  </label>
                  <input
                    id="contact-phone"
                    type="tel"
                    autoComplete="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder={content.contact.phonePlaceholder}
                    className="w-full px-4 py-3 text-sm rounded-xl bg-[#fbfbfd] border border-neutral-200/80 text-[#1d1d1f] placeholder-neutral-400 focus:outline-none focus:border-[#1d1d1f] focus:ring-1 focus:ring-[#1d1d1f] focus:bg-white font-poppins transition-all"
                  />
                </div>

                <div className="contact-input-field">
                  <label htmlFor="contact-message" className="sr-only">
                    {content.contact.messagePlaceholder}
                  </label>
                  <textarea
                    id="contact-message"
                    ref={messageRef}
                    required
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder={`${content.contact.messagePlaceholder} *`}
                    className="w-full px-4 py-3 text-sm rounded-xl bg-[#fbfbfd] border border-neutral-200/80 text-[#1d1d1f] placeholder-neutral-400 focus:outline-none focus:border-[#1d1d1f] focus:ring-1 focus:ring-[#1d1d1f] focus:bg-white font-poppins resize-none transition-all"
                  />
                </div>

                {/* Honeypot: people never see or fill it; /api/contact drops messages that have it. */}
                <div
                  aria-hidden="true"
                  className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden"
                >
                  <label htmlFor="contact-website">Website</label>
                  <input
                    id="contact-website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                <div className="contact-input-field pt-2">
                  <button
                    type="submit"
                    disabled={status === 'sending'}
                    className="w-full sm:w-auto px-8 py-3 font-poppins font-medium uppercase text-xs sm:text-sm tracking-wider text-white transition-all shadow-xs hover:bg-[#a63715] active:scale-98 flex items-center justify-center gap-2 rounded-full cursor-pointer bg-[#8e2e11] disabled:opacity-70 disabled:cursor-wait"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      {status === 'sending' ? content.contact.sending : content.contact.submitBtn}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right Column (左右侧入场 - Enters from Right): Authentic Image + Postal Address Box */}
          <div ref={rightColRef} className="lg:col-span-6 space-y-6 will-change-transform">
            {/* Authentic Photograph */}
            <div className="overflow-hidden rounded-2xl shadow-xs border border-neutral-200/80 group">
              <img
                src="/images/contact-photo.jpg"
                alt="CAACI Community Event"
                className="w-full h-[280px] md:h-[320px] object-cover transition-transform duration-500 group-hover:scale-101"
              />
            </div>

            {/* Restrained Info Card matching /membership/ Apple Dark Card style */}
            <div className="p-8 rounded-2xl text-center text-white shadow-sm border border-white/10 bg-[#1d1d1f] transition-all">
              <div className="space-y-2.5 font-poppins">
                <div className="flex items-center justify-center gap-2 text-white/90 text-sm">
                  <MapPin className="w-4 h-4 text-[#8e2e11]" />
                  <span className="font-medium text-base sm:text-lg">
                    {content.contact.addressLine1}
                  </span>
                </div>
                <div className="text-neutral-300 font-normal text-sm sm:text-base">
                  {content.contact.addressLine2}
                </div>
                <div className="pt-3">
                  <a
                    href={`mailto:${content.contact.email}`}
                    className="inline-flex items-center gap-2 text-white font-medium text-base tracking-wide hover:underline hover:text-neutral-200 transition-colors"
                  >
                    <Mail className="w-4 h-4 text-[#8e2e11]" />
                    <span>{content.contact.email}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

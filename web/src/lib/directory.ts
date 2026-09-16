import { supabase } from './supabase';
import type { BusinessMerchant } from '../data/pages/business';

// Filter categories on the Business Services page, in pill order. These are
// also the business_directory.category values (CATEGORIES in
// functions/api/admin/business.js); anything else lands in 'services'.
export const DIRECTORY_CATEGORIES: { id: string; en: string; zh: string }[] = [
  { id: 'restaurant', en: 'Dining & Beverages', zh: '餐饮与茶饮' },
  { id: 'groceries', en: 'Groceries & Markets', zh: '超市与食品' },
  { id: 'dental', en: 'Dental Clinics', zh: '牙科诊所' },
  { id: 'financial', en: 'Banking & Financial', zh: '银行与金融' },
  { id: 'realestate', en: 'Real Estate & Insurance', zh: '房产与保险' },
  { id: 'education_media', en: 'Education & Media', zh: '教育与传媒' },
  { id: 'services', en: 'Other Services', zh: '其他服务' },
];
const OTHER = DIRECTORY_CATEGORIES[DIRECTORY_CATEGORIES.length - 1];

// The values the join-the-directory form may send (what the admin panel accepts).
export const LISTING_CATEGORIES = DIRECTORY_CATEGORIES;

export interface DirectoryRow {
  id: string;
  name: string;
  name_zh: string | null;
  category: string | null;
  label: string | null;
  label_zh: string | null;
  description: string | null;
  description_zh: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  hours_zh: string | null;
  website: string | null;
  verified: boolean | null;
  tags: string[] | null;
  tags_zh: string[] | null;
}

const COLUMNS =
  'id,name,name_zh,category,label,label_zh,description,description_zh,address,phone,' +
  'hours,hours_zh,website,verified,tags,tags_zh';

// Approved listings only (biz_read RLS returns nothing else to anon anyway), in
// the admin panel's sort order. null = the read failed (network, or the 0022
// columns are not in the database yet), so the page can fall back to its
// built-in list; [] = the directory really is empty.
export async function loadApprovedListings(): Promise<DirectoryRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('business_directory')
      .select(COLUMNS)
      .eq('approved', true)
      .order('sort_order')
      .order('name');
    if (error || !Array.isArray(data)) return null;
    return data as unknown as DirectoryRow[];
  } catch {
    return null;
  }
}

// Only http(s) links are rendered as hrefs; a bare domain gets https://.
function safeWebsite(raw: string | null): string | undefined {
  const s = (raw || '').trim();
  if (!s) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

// The name without its Chinese part, for the Maps query: "Kung Fu Tea (功夫茶)"
// -> "Kung Fu Tea". A name that is all Chinese is kept as it is.
const HAN = /[㐀-鿿豈-﫿]/;
export function mapsName(name: string): string {
  const stripped = name
    .replace(/[(（][^()（）]*[)）]/g, (m) => (HAN.test(m) ? ' ' : m))
    .replace(/[㐀-鿿豈-﫿]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || name.trim();
}

const text = (s: string | null | undefined) => (s || '').trim();
const list = (a: string[] | null | undefined) => (Array.isArray(a) ? a.filter(Boolean) : []);

export function rowToMerchant(row: DirectoryRow, lang: 'en' | 'zh'): BusinessMerchant {
  const zh = lang === 'zh';
  // Each Chinese field falls back to the English one when empty (and back again).
  const pick = (en: string | null, cn: string | null) =>
    zh ? text(cn) || text(en) : text(en) || text(cn);
  const cat = DIRECTORY_CATEGORIES.find((c) => c.id === row.category) ?? OTHER;
  const tags = zh ? list(row.tags_zh) : list(row.tags);
  return {
    id: `db-${row.id}`,
    name: pick(row.name, row.name_zh),
    nameEn: mapsName(row.name),
    category: cat.id,
    categoryLabel: pick(row.label, row.label_zh) || (zh ? cat.zh : cat.en),
    address: text(row.address),
    phone: text(row.phone) || undefined,
    hours: pick(row.hours, row.hours_zh) || undefined,
    website: safeWebsite(row.website),
    desc: pick(row.description, row.description_zh),
    featured: !!row.verified,
    tags: tags.length ? tags : zh ? list(row.tags) : list(row.tags_zh),
  };
}

// Google Maps search for the merchant. The English name goes in the query (the
// display name carries Chinese on /zh/, which sent Maps to the wrong place), and
// only merchants with an address get the link at all — a bare name matched
// anything with similar words.
export function directionsUrl(m: Pick<BusinessMerchant, 'name' | 'nameEn' | 'address'>): string {
  const query = [m.nameEn || m.name, m.address]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// The cards come from business_directory, which the admin panel manages. The
// built-in list is only a fallback for when that read fails, so the page is
// never empty because of a network error; a successful empty read shows none.
export function directoryMerchants(
  fallback: BusinessMerchant[],
  rows: DirectoryRow[] | null,
  lang: 'en' | 'zh',
): BusinessMerchant[] {
  return rows === null ? fallback : rows.map((r) => rowToMerchant(r, lang));
}

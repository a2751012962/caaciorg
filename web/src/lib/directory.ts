import { supabase } from './supabase';
import type { BusinessMerchant } from '../data/pages/business';

// Filter categories on the Business Services page, in pill order. Static
// merchants in data/pages/business.ts use these ids directly; approved
// business_directory rows are mapped onto them by category below.
export const DIRECTORY_CATEGORIES: { id: string; en: string; zh: string }[] = [
  { id: 'restaurant', en: 'Dining & Beverages', zh: '餐饮与茶饮' },
  { id: 'groceries', en: 'Groceries & Markets', zh: '超市与食品' },
  { id: 'dental', en: 'Dental Clinics', zh: '牙科诊所' },
  { id: 'financial', en: 'Banking & Financial', zh: '银行与金融' },
  { id: 'realestate', en: 'Real Estate & Insurance', zh: '房产与保险' },
  { id: 'education_media', en: 'Education & Media', zh: '教育与传媒' },
  { id: 'services', en: 'Other Services', zh: '其他服务' },
];

// business_directory.category is one of restaurant | bakery | supermarket | other
// (CATEGORIES in functions/api/admin/business.js); public submissions may hold
// anything else, which lands in the catch-all bucket.
const DB_CATEGORY: Record<string, { id: string; en: string; zh: string }> = {
  restaurant: { id: 'restaurant', en: 'Restaurant', zh: '餐厅' },
  bakery: { id: 'restaurant', en: 'Bakery', zh: '烘焙店' },
  supermarket: { id: 'groceries', en: 'Supermarket', zh: '超市' },
};
const OTHER = { id: 'services', en: 'Services', zh: '服务' };

// The values the join-the-directory form may send (what the admin panel accepts).
export const LISTING_CATEGORIES: { id: string; en: string; zh: string }[] = [
  { id: 'restaurant', en: 'Restaurant', zh: '餐厅' },
  { id: 'bakery', en: 'Bakery', zh: '烘焙店' },
  { id: 'supermarket', en: 'Supermarket / grocery', zh: '超市 / 食品店' },
  { id: 'other', en: 'Other service', zh: '其他服务' },
];

export interface DirectoryRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
}

// Approved listings only (biz_read RLS returns nothing else to anon anyway).
export async function loadApprovedListings(): Promise<DirectoryRow[]> {
  try {
    const { data, error } = await supabase
      .from('business_directory')
      .select('id,name,category,description,address,phone,website')
      .eq('approved', true)
      .order('name');
    if (error || !Array.isArray(data)) return [];
    return data as DirectoryRow[];
  } catch {
    return [];
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

export function rowToMerchant(row: DirectoryRow, lang: 'en' | 'zh'): BusinessMerchant {
  const cat = DB_CATEGORY[(row.category || '').toLowerCase()] ?? OTHER;
  return {
    id: `db-${row.id}`,
    name: row.name,
    nameEn: row.name,
    category: cat.id,
    categoryLabel: lang === 'zh' ? cat.zh : cat.en,
    address: row.address || '',
    phone: row.phone || undefined,
    website: safeWebsite(row.website),
    desc: row.description || '',
  };
}

// Static merchants first, then approved listings not already among them.
export function mergeMerchants(
  staticMerchants: BusinessMerchant[],
  rows: DirectoryRow[],
  lang: 'en' | 'zh',
): BusinessMerchant[] {
  const key = (s: string | undefined) => (s || '').trim().toLowerCase();
  const known = new Set(staticMerchants.flatMap((m) => [key(m.name), key(m.nameEn)]));
  const extra = rows.filter((r) => !known.has(key(r.name))).map((r) => rowToMerchant(r, lang));
  return [...staticMerchants, ...extra];
}

export interface SeedService {
  name: string;
  durationMin: number;
  defaultPrice: number;
  description?: string;
}

export interface SeedCategory {
  name: string;
  slug: string;
  description?: string;
  order: number;
  services: SeedService[];
}

/**
 * Default salon/beauty catalogue — a broad, market-representative set of the most
 * common services so a fresh database is immediately useful. Prices are in Toman
 * (sane defaults; stylists override per service). Categories are matched by
 * `slug` and services by (categoryId, name), so re-seeding is idempotent.
 *
 * IMPORTANT: the seed only UPSERTS (never prunes). To avoid leaving orphaned
 * near-duplicates on existing databases, the ORIGINAL service names are kept
 * exactly; new services are only added. Renaming an existing item here would
 * create a second row on already-seeded DBs. All seeded rows are
 * `isDefault: true`; stylist-created custom services are never touched.
 */
export const seedCategories: SeedCategory[] = [
  {
    name: 'مو (زنانه)',
    slug: 'hair-women',
    description: 'خدمات موی زنانه',
    order: 1,
    services: [
      { name: 'کوتاهی مو', durationMin: 45, defaultPrice: 200000 },
      { name: 'اصلاح و فرم‌دهی مو', durationMin: 45, defaultPrice: 180000 },
      { name: 'رنگ مو', durationMin: 120, defaultPrice: 600000 },
      { name: 'رنگ ریشه', durationMin: 75, defaultPrice: 350000 },
      { name: 'هایلایت', durationMin: 150, defaultPrice: 900000 },
      { name: 'لولایت', durationMin: 150, defaultPrice: 900000 },
      { name: 'مش', durationMin: 150, defaultPrice: 850000 },
      { name: 'آمبره', durationMin: 180, defaultPrice: 1100000 },
      { name: 'سامبره', durationMin: 180, defaultPrice: 1100000 },
      { name: 'بالیاژ', durationMin: 210, defaultPrice: 1300000 },
      { name: 'کراتین', durationMin: 180, defaultPrice: 1200000 },
      { name: 'بوتاکس مو', durationMin: 150, defaultPrice: 1000000 },
      { name: 'احیا و پروتئین مو', durationMin: 120, defaultPrice: 700000 },
      { name: 'ماسک و ترمیم مو', durationMin: 60, defaultPrice: 350000 },
      { name: 'صافی دائم مو', durationMin: 180, defaultPrice: 1200000 },
      { name: 'فر مو', durationMin: 150, defaultPrice: 800000 },
      { name: 'شینیون', durationMin: 90, defaultPrice: 500000 },
      { name: 'بافت مو', durationMin: 60, defaultPrice: 300000 },
      { name: 'براشینگ', durationMin: 45, defaultPrice: 150000 },
      { name: 'اکستنشن مو', durationMin: 180, defaultPrice: 1500000 },
    ],
  },
  {
    name: 'مو (مردانه)',
    slug: 'hair-men',
    description: 'خدمات موی مردانه',
    order: 2,
    services: [
      { name: 'کوتاهی مو مردانه', durationMin: 30, defaultPrice: 120000 },
      { name: 'فید', durationMin: 40, defaultPrice: 150000 },
      { name: 'اصلاح صورت', durationMin: 20, defaultPrice: 70000 },
      { name: 'اصلاح و فرم ریش', durationMin: 30, defaultPrice: 100000 },
      { name: 'رنگ مو مردانه', durationMin: 60, defaultPrice: 300000 },
      { name: 'حالت‌دهی مو', durationMin: 20, defaultPrice: 80000 },
      { name: 'کاشت و پروتز مو', durationMin: 120, defaultPrice: 2000000 },
    ],
  },
  {
    name: 'ناخن',
    slug: 'nails',
    description: 'خدمات ناخن',
    order: 3,
    services: [
      { name: 'مانیکور', durationMin: 45, defaultPrice: 200000 },
      { name: 'پدیکور', durationMin: 60, defaultPrice: 250000 },
      { name: 'کاشت ناخن', durationMin: 120, defaultPrice: 500000 },
      { name: 'کاشت ناخن با فرم', durationMin: 120, defaultPrice: 520000 },
      { name: 'کاشت ناخن با تیپ', durationMin: 120, defaultPrice: 520000 },
      { name: 'ترمیم ناخن', durationMin: 60, defaultPrice: 200000 },
      { name: 'ژلیش', durationMin: 60, defaultPrice: 250000 },
      { name: 'لاک ژل', durationMin: 45, defaultPrice: 200000 },
      { name: 'لمینت و تقویت ناخن', durationMin: 60, defaultPrice: 300000 },
      { name: 'طراحی ناخن', durationMin: 30, defaultPrice: 120000 },
      { name: 'برداشتن کاشت', durationMin: 30, defaultPrice: 100000 },
    ],
  },
  {
    name: 'پوست و صورت',
    slug: 'skin-face',
    description: 'خدمات پوست و صورت',
    order: 4,
    services: [
      { name: 'پاکسازی پوست', durationMin: 75, defaultPrice: 400000 },
      { name: 'فیشیال', durationMin: 60, defaultPrice: 450000 },
      { name: 'هیدروفیشیال', durationMin: 75, defaultPrice: 650000 },
      { name: 'میکرودرم', durationMin: 60, defaultPrice: 500000 },
      { name: 'ماساژ صورت', durationMin: 45, defaultPrice: 300000 },
      { name: 'ماسک صورت', durationMin: 30, defaultPrice: 200000 },
      { name: 'درمان آکنه', durationMin: 60, defaultPrice: 500000 },
      { name: 'آبرسانی پوست', durationMin: 60, defaultPrice: 450000 },
      { name: 'لایه‌برداری و پیلینگ', durationMin: 60, defaultPrice: 550000 },
      { name: 'وکس صورت', durationMin: 20, defaultPrice: 100000 },
    ],
  },
  {
    name: 'اصلاح و وکس',
    slug: 'waxing',
    description: 'اصلاح، بند و وکس',
    order: 5,
    services: [
      { name: 'بند انداختن صورت', durationMin: 20, defaultPrice: 80000 },
      { name: 'اصلاح ابرو', durationMin: 20, defaultPrice: 80000 },
      { name: 'وکس بدن', durationMin: 60, defaultPrice: 400000 },
      { name: 'وکس دست و پا', durationMin: 45, defaultPrice: 300000 },
      { name: 'وکس زیربغل', durationMin: 15, defaultPrice: 100000 },
      { name: 'وکس بیکینی', durationMin: 30, defaultPrice: 250000 },
      { name: 'اصلاح با تیغ و ماشین', durationMin: 30, defaultPrice: 150000 },
    ],
  },
  {
    name: 'ابرو و مژه',
    slug: 'brows-lashes',
    description: 'خدمات ابرو و مژه',
    order: 6,
    services: [
      { name: 'طراحی ابرو', durationMin: 30, defaultPrice: 150000 },
      { name: 'اکستنشن مژه', durationMin: 120, defaultPrice: 600000 },
      { name: 'لیفت مژه', durationMin: 60, defaultPrice: 350000 },
      { name: 'لمینت ابرو', durationMin: 60, defaultPrice: 350000 },
      { name: 'رنگ ابرو', durationMin: 30, defaultPrice: 120000 },
      { name: 'هاشور و میکروبلیدینگ ابرو', durationMin: 120, defaultPrice: 1500000 },
      { name: 'رنگ مژه', durationMin: 30, defaultPrice: 120000 },
    ],
  },
  {
    name: 'آرایش (میکاپ)',
    slug: 'makeup',
    description: 'خدمات آرایش و میکاپ',
    order: 7,
    services: [
      { name: 'آرایش روزانه', durationMin: 45, defaultPrice: 350000 },
      { name: 'میکاپ مجلسی', durationMin: 90, defaultPrice: 900000 },
      { name: 'میکاپ عروس', durationMin: 180, defaultPrice: 2500000 },
      { name: 'آرایش نامزدی', durationMin: 120, defaultPrice: 1500000 },
      { name: 'خودآرایی و آموزش', durationMin: 90, defaultPrice: 700000 },
    ],
  },
  {
    name: 'زیبایی عروس',
    slug: 'bridal',
    description: 'پکیج‌های عروس و نامزدی',
    order: 8,
    services: [
      { name: 'پکیج کامل عروس', durationMin: 300, defaultPrice: 5000000 },
      { name: 'پکیج نامزدی', durationMin: 180, defaultPrice: 2500000 },
      { name: 'شینیون عروس', durationMin: 120, defaultPrice: 900000 },
    ],
  },
  {
    name: 'خدمات تخصصی زیبایی',
    slug: 'specialty',
    description: 'خدمات تخصصی پوست، لیزر و ماساژ',
    order: 9,
    services: [
      { name: 'لیزر موهای زائد', durationMin: 60, defaultPrice: 500000 },
      { name: 'فیلر صورت', durationMin: 45, defaultPrice: 3000000 },
      { name: 'بوتاکس صورت', durationMin: 45, defaultPrice: 2500000 },
      { name: 'ماساژ بدن', durationMin: 60, defaultPrice: 500000 },
      { name: 'تاتو', durationMin: 90, defaultPrice: 1000000 },
      { name: 'پاک‌سازی تاتو', durationMin: 45, defaultPrice: 800000 },
    ],
  },
];

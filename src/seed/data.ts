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
 * Default salon/beauty catalogue. Prices are in Toman (sane defaults; stylists
 * override per service). Categories are matched by `slug` and services by
 * (categoryId, name) so re-seeding is idempotent.
 */
export const seedCategories: SeedCategory[] = [
  {
    name: 'مو (زنانه)',
    slug: 'hair-women',
    description: 'خدمات موی زنانه',
    order: 1,
    services: [
      { name: 'کوتاهی مو', durationMin: 45, defaultPrice: 200000 },
      { name: 'رنگ مو', durationMin: 120, defaultPrice: 600000 },
      { name: 'هایلایت', durationMin: 150, defaultPrice: 900000 },
      { name: 'مش', durationMin: 150, defaultPrice: 850000 },
      { name: 'کراتین', durationMin: 180, defaultPrice: 1200000 },
      { name: 'بوتاکس مو', durationMin: 150, defaultPrice: 1000000 },
      { name: 'احیا و پروتئین مو', durationMin: 120, defaultPrice: 700000 },
      { name: 'براشینگ', durationMin: 45, defaultPrice: 150000 },
      { name: 'شینیون', durationMin: 90, defaultPrice: 500000 },
    ],
  },
  {
    name: 'مو (مردانه)',
    slug: 'hair-men',
    description: 'خدمات موی مردانه',
    order: 2,
    services: [
      { name: 'کوتاهی مو مردانه', durationMin: 30, defaultPrice: 120000 },
      { name: 'اصلاح صورت', durationMin: 20, defaultPrice: 70000 },
      { name: 'رنگ مو مردانه', durationMin: 60, defaultPrice: 300000 },
      { name: 'حالت‌دهی مو', durationMin: 20, defaultPrice: 80000 },
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
      { name: 'ژلیش', durationMin: 60, defaultPrice: 250000 },
      { name: 'لاک ژل', durationMin: 45, defaultPrice: 200000 },
      { name: 'ترمیم ناخن', durationMin: 60, defaultPrice: 200000 },
      { name: 'طراحی ناخن', durationMin: 30, defaultPrice: 120000 },
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
      { name: 'میکرودرم', durationMin: 60, defaultPrice: 500000 },
      { name: 'ماساژ صورت', durationMin: 45, defaultPrice: 300000 },
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
    ],
  },
  {
    name: 'آرایش (میکاپ)',
    slug: 'makeup',
    description: 'خدمات آرایش و میکاپ',
    order: 7,
    services: [
      { name: 'میکاپ عروس', durationMin: 180, defaultPrice: 2500000 },
      { name: 'میکاپ مجلسی', durationMin: 90, defaultPrice: 900000 },
      { name: 'آرایش روزانه', durationMin: 45, defaultPrice: 350000 },
    ],
  },
  {
    name: 'زیبایی عروس',
    slug: 'bridal',
    description: 'پکیج‌های عروس',
    order: 8,
    services: [
      { name: 'پکیج کامل عروس', durationMin: 300, defaultPrice: 5000000 },
    ],
  },
];

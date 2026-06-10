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

export const seedCategories: SeedCategory[] = [
  {
    name: 'مو',
    slug: 'hair',
    description: 'خدمات مو',
    order: 1,
    services: [
      { name: 'کوتاهی مو', durationMin: 30, defaultPrice: 150000 },
      { name: 'رنگ مو', durationMin: 120, defaultPrice: 600000 },
      { name: 'کراتین', durationMin: 180, defaultPrice: 1200000 },
    ],
  },
  {
    name: 'ناخن',
    slug: 'nails',
    description: 'خدمات ناخن',
    order: 2,
    services: [
      { name: 'مانیکور', durationMin: 45, defaultPrice: 200000 },
      { name: 'پدیکور', durationMin: 60, defaultPrice: 250000 },
      { name: 'کاشت ناخن', durationMin: 120, defaultPrice: 500000 },
    ],
  },
  {
    name: 'پوست و صورت',
    slug: 'skin-face',
    description: 'خدمات پوست و صورت',
    order: 3,
    services: [
      { name: 'اصلاح ابرو', durationMin: 20, defaultPrice: 80000 },
      { name: 'پاکسازی پوست', durationMin: 75, defaultPrice: 400000 },
    ],
  },
];

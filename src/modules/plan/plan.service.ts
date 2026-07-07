import type { PlanTier } from '../../models/StylistProfile';
import { getPlanSmsLimits } from '../../models/StylistProfile';

export interface PlanFeature {
  text: string;
  icon: string;
  included: boolean;
}

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  tagline: string;
  icon: string;
  /** Monthly price in Toman. null = contact for pricing (no billing yet). */
  price: number | null;
  priceLabel: string;
  durationLabel: string;
  smsCount: number;
  features: PlanFeature[];
}

const PLANS: PlanDefinition[] = [
  {
    tier: 'free',
    label: 'عادی',
    tagline: 'شروع کار',
    icon: '🟢',
    price: 0,
    priceLabel: 'رایگان',
    durationLabel: 'نامحدود',
    smsCount: 0,
    features: [
      { text: 'دریافت رزرو و مدیریت نوبت‌ها', icon: '📅', included: true },
      { text: 'تنظیم ساعات کاری و محل کار', icon: '⏰', included: true },
      { text: 'نمایش در جستجو و پروفایل عمومی', icon: '🔍', included: true },
      { text: 'گزارش و آنالیز پایه', icon: '📊', included: true },
      { text: 'سیاست کنسلی: پیروی از سیاست سالن', icon: '📋', included: true },
      { text: 'پنل پیامک تخفیف به مشتری‌ها', icon: '📨', included: false },
      { text: 'سیاست کنسلی اختصاصی', icon: '⚙️', included: false },
      { text: 'انتشار پست در شونه‌گرام', icon: '📸', included: false },
    ],
  },
  {
    tier: 'silver',
    label: 'نقره‌ای',
    tagline: 'رشد کسب‌وکار',
    icon: '🥈',
    price: null,
    priceLabel: 'با پشتیبانی تماس بگیرید',
    durationLabel: 'ماهانه',
    smsCount: getPlanSmsLimits('silver').dailyMax,
    features: [
      { text: 'دریافت رزرو و مدیریت نوبت‌ها', icon: '📅', included: true },
      { text: 'تنظیم ساعات کاری و محل کار', icon: '⏰', included: true },
      { text: 'نمایش در جستجو و پروفایل عمومی', icon: '🔍', included: true },
      { text: 'گزارش و آنالیز پایه', icon: '📊', included: true },
      { text: 'سیاست کنسلی اختصاصی با بازه‌های استاندارد', icon: '📋', included: true },
      { text: 'تعیین جابه‌جایی رایگان و درصد جریمه', icon: '⚙️', included: true },
      { text: 'پنل پیامک تخفیف به مشتری‌ها', icon: '📨', included: true },
      { text: 'انتشار پست در شونه‌گرام', icon: '📸', included: false },
    ],
  },
  {
    tier: 'gold',
    label: 'طلایی',
    tagline: 'حرفه‌ای',
    icon: '🥇',
    price: null,
    priceLabel: 'با پشتیبانی تماس بگیرید',
    durationLabel: 'ماهانه',
    smsCount: getPlanSmsLimits('gold').dailyMax,
    features: [
      { text: 'دریافت رزرو و مدیریت نوبت‌ها', icon: '📅', included: true },
      { text: 'تنظیم ساعات کاری و محل کار', icon: '⏰', included: true },
      { text: 'نمایش در جستجو و پروفایل عمومی', icon: '🔍', included: true },
      { text: 'گزارش و آنالیز پایه', icon: '📊', included: true },
      { text: 'سیاست کنسلی کاملاً دلخواه', icon: '📋', included: true },
      { text: 'سیاست کنسلی جداگانه برای هر خدمت', icon: '⚙️', included: true },
      { text: 'پنل پیامک تخفیف به مشتری‌ها', icon: '📨', included: true },
      { text: 'انتشار پست و استوری در شونه‌گرام', icon: '📸', included: true },
    ],
  },
];

export function getPlans(): PlanDefinition[] {
  return PLANS;
}

export function getPlan(tier: PlanTier): PlanDefinition | undefined {
  return PLANS.find((p) => p.tier === tier);
}

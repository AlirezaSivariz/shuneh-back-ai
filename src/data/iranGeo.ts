/**
 * Iran provinces & cities — a LOCAL, static dataset (no external API).
 *
 * Each province carries its administrative-center coordinates and a curated list
 * of its major cities, each with an approximate city-center lat/lng. Coordinates
 * are good enough to use as a MAP STARTING POINT (the user then drags the pin to
 * the exact spot); they are not survey-grade. All 31 provinces are present and
 * every province has at least its capital, so the dependent province→city selects
 * always resolve.
 *
 * Shared source of truth: the backend validates salon province/city against this,
 * and it is served verbatim to the frontend via `GET /geo/provinces`.
 */
export interface GeoCity {
  name: string;
  lat: number;
  lng: number;
}

export interface GeoProvince {
  name: string;
  /** Province administrative-center coordinates (≈ the capital). */
  lat: number;
  lng: number;
  cities: GeoCity[];
}

export const iranProvinces: GeoProvince[] = [
  {
    name: 'آذربایجان شرقی',
    lat: 38.08,
    lng: 46.2919,
    cities: [
      { name: 'تبریز', lat: 38.08, lng: 46.2919 },
      { name: 'مراغه', lat: 37.3917, lng: 46.2398 },
      { name: 'مرند', lat: 38.4329, lng: 45.774 },
      { name: 'میانه', lat: 37.4214, lng: 47.7158 },
      { name: 'اهر', lat: 38.4769, lng: 47.07 },
      { name: 'بناب', lat: 37.3404, lng: 46.0563 },
      { name: 'شبستر', lat: 38.1797, lng: 45.7028 },
      { name: 'سراب', lat: 37.9417, lng: 47.5366 },
      { name: 'جلفا', lat: 38.9405, lng: 45.6308 },
      { name: 'هادیشهر', lat: 38.8333, lng: 45.6333 },
    ],
  },
  {
    name: 'آذربایجان غربی',
    lat: 37.5527,
    lng: 45.076,
    cities: [
      { name: 'ارومیه', lat: 37.5527, lng: 45.076 },
      { name: 'خوی', lat: 38.5503, lng: 44.9521 },
      { name: 'میاندوآب', lat: 36.9697, lng: 46.1027 },
      { name: 'مهاباد', lat: 36.7631, lng: 45.7222 },
      { name: 'بوکان', lat: 36.5213, lng: 46.2089 },
      { name: 'سلماس', lat: 38.1985, lng: 44.7654 },
      { name: 'نقده', lat: 36.9554, lng: 45.388 },
      { name: 'پیرانشهر', lat: 36.6941, lng: 45.1413 },
      { name: 'سردشت', lat: 36.1556, lng: 45.4789 },
      { name: 'ماکو', lat: 39.2953, lng: 44.4979 },
    ],
  },
  {
    name: 'اردبیل',
    lat: 38.2498,
    lng: 48.2933,
    cities: [
      { name: 'اردبیل', lat: 38.2498, lng: 48.2933 },
      { name: 'پارس‌آباد', lat: 39.6482, lng: 47.9174 },
      { name: 'مشگین‌شهر', lat: 38.3987, lng: 47.6818 },
      { name: 'خلخال', lat: 37.619, lng: 48.5258 },
      { name: 'گرمی', lat: 39.0103, lng: 48.082 },
      { name: 'بیله‌سوار', lat: 39.3781, lng: 48.3531 },
      { name: 'نمین', lat: 38.4258, lng: 48.4847 },
      { name: 'نیر', lat: 38.0356, lng: 47.9986 },
    ],
  },
  {
    name: 'اصفهان',
    lat: 32.6539,
    lng: 51.666,
    cities: [
      { name: 'اصفهان', lat: 32.6539, lng: 51.666 },
      { name: 'کاشان', lat: 33.985, lng: 51.41 },
      { name: 'خمینی‌شهر', lat: 32.7009, lng: 51.5212 },
      { name: 'نجف‌آباد', lat: 32.6342, lng: 51.3666 },
      { name: 'شاهین‌شهر', lat: 32.865, lng: 51.5524 },
      { name: 'شهرضا', lat: 32.0089, lng: 51.8667 },
      { name: 'گلپایگان', lat: 33.4534, lng: 50.288 },
      { name: 'نطنز', lat: 33.5106, lng: 51.9169 },
      { name: 'آران و بیدگل', lat: 34.0568, lng: 51.4844 },
      { name: 'مبارکه', lat: 32.346, lng: 51.504 },
      { name: 'فلاورجان', lat: 32.5556, lng: 51.5114 },
      { name: 'سمیرم', lat: 31.4167, lng: 51.5667 },
    ],
  },
  {
    name: 'البرز',
    lat: 35.84,
    lng: 50.9391,
    cities: [
      { name: 'کرج', lat: 35.84, lng: 50.9391 },
      { name: 'فردیس', lat: 35.7256, lng: 50.9756 },
      { name: 'نظرآباد', lat: 35.9514, lng: 50.6063 },
      { name: 'هشتگرد', lat: 35.9618, lng: 50.689 },
      { name: 'کمال‌شهر', lat: 35.8866, lng: 50.8694 },
      { name: 'محمدشهر', lat: 35.7456, lng: 50.905 },
      { name: 'ماهدشت', lat: 35.7269, lng: 50.8056 },
      { name: 'اشتهارد', lat: 35.7242, lng: 50.3658 },
    ],
  },
  {
    name: 'ایلام',
    lat: 33.6374,
    lng: 46.4227,
    cities: [
      { name: 'ایلام', lat: 33.6374, lng: 46.4227 },
      { name: 'دهلران', lat: 32.6941, lng: 47.2678 },
      { name: 'آبدانان', lat: 32.9926, lng: 47.4192 },
      { name: 'ایوان', lat: 33.827, lng: 46.3097 },
      { name: 'دره‌شهر', lat: 33.1389, lng: 47.3766 },
      { name: 'مهران', lat: 33.1222, lng: 46.1646 },
      { name: 'سرابله', lat: 33.7686, lng: 46.5644 },
      { name: 'چوار', lat: 33.6919, lng: 46.3 },
    ],
  },
  {
    name: 'بوشهر',
    lat: 28.9234,
    lng: 50.8203,
    cities: [
      { name: 'بوشهر', lat: 28.9234, lng: 50.8203 },
      { name: 'برازجان', lat: 29.2667, lng: 51.2167 },
      { name: 'گناوه', lat: 29.58, lng: 50.516 },
      { name: 'خورموج', lat: 28.6494, lng: 51.3792 },
      { name: 'کنگان', lat: 27.8376, lng: 52.0626 },
      { name: 'دیلم', lat: 30.0567, lng: 50.1614 },
      { name: 'جم', lat: 27.827, lng: 52.326 },
      { name: 'عسلویه', lat: 27.4783, lng: 52.6075 },
      { name: 'بندر دیر', lat: 27.8392, lng: 51.9369 },
    ],
  },
  {
    name: 'تهران',
    lat: 35.6892,
    lng: 51.389,
    cities: [
      { name: 'تهران', lat: 35.6892, lng: 51.389 },
      { name: 'اسلامشهر', lat: 35.5447, lng: 51.231 },
      { name: 'شهریار', lat: 35.6595, lng: 51.0581 },
      { name: 'قدس', lat: 35.7211, lng: 51.1108 },
      { name: 'ملارد', lat: 35.6657, lng: 50.9767 },
      { name: 'پاکدشت', lat: 35.4716, lng: 51.684 },
      { name: 'ورامین', lat: 35.3242, lng: 51.6457 },
      { name: 'رباط‌کریم', lat: 35.4847, lng: 51.0829 },
      { name: 'پردیس', lat: 35.7397, lng: 51.817 },
      { name: 'دماوند', lat: 35.7156, lng: 52.0651 },
      { name: 'فیروزکوه', lat: 35.7503, lng: 52.77 },
      { name: 'شهرری', lat: 35.5928, lng: 51.4343 },
      { name: 'قرچک', lat: 35.4399, lng: 51.5689 },
      { name: 'پرند', lat: 35.4886, lng: 50.9509 },
      { name: 'پیشوا', lat: 35.3097, lng: 51.7244 },
      { name: 'بومهن', lat: 35.7297, lng: 51.8636 },
    ],
  },
  {
    name: 'چهارمحال و بختیاری',
    lat: 32.3256,
    lng: 50.8644,
    cities: [
      { name: 'شهرکرد', lat: 32.3256, lng: 50.8644 },
      { name: 'بروجن', lat: 31.9658, lng: 51.2872 },
      { name: 'فارسان', lat: 32.2567, lng: 50.5667 },
      { name: 'لردگان', lat: 31.5103, lng: 50.8294 },
      { name: 'سامان', lat: 32.4517, lng: 50.9119 },
      { name: 'فرخ‌شهر', lat: 32.2706, lng: 50.985 },
      { name: 'اردل', lat: 31.9997, lng: 50.6611 },
    ],
  },
  {
    name: 'خراسان جنوبی',
    lat: 32.8649,
    lng: 59.2262,
    cities: [
      { name: 'بیرجند', lat: 32.8649, lng: 59.2262 },
      { name: 'قائن', lat: 33.7267, lng: 59.184 },
      { name: 'فردوس', lat: 34.019, lng: 58.174 },
      { name: 'طبس', lat: 33.5959, lng: 56.9244 },
      { name: 'نهبندان', lat: 31.5418, lng: 60.0357 },
      { name: 'سرایان', lat: 33.8636, lng: 58.5219 },
      { name: 'بشرویه', lat: 33.8636, lng: 57.4283 },
    ],
  },
  {
    name: 'خراسان رضوی',
    lat: 36.2605,
    lng: 59.6168,
    cities: [
      { name: 'مشهد', lat: 36.2605, lng: 59.6168 },
      { name: 'نیشابور', lat: 36.2133, lng: 58.7958 },
      { name: 'سبزوار', lat: 36.2126, lng: 57.6819 },
      { name: 'تربت حیدریه', lat: 35.274, lng: 59.2197 },
      { name: 'تربت جام', lat: 35.244, lng: 60.6225 },
      { name: 'قوچان', lat: 37.106, lng: 58.5095 },
      { name: 'کاشمر', lat: 35.2383, lng: 58.4656 },
      { name: 'گناباد', lat: 34.3529, lng: 58.6831 },
      { name: 'سرخس', lat: 36.5453, lng: 61.1564 },
      { name: 'چناران', lat: 36.6453, lng: 59.12 },
      { name: 'تایباد', lat: 34.74, lng: 60.7756 },
      { name: 'فریمان', lat: 35.7011, lng: 59.8487 },
    ],
  },
  {
    name: 'خراسان شمالی',
    lat: 37.4747,
    lng: 57.329,
    cities: [
      { name: 'بجنورد', lat: 37.4747, lng: 57.329 },
      { name: 'شیروان', lat: 37.3953, lng: 57.9292 },
      { name: 'اسفراین', lat: 37.0764, lng: 57.51 },
      { name: 'آشخانه', lat: 37.5664, lng: 56.9183 },
      { name: 'جاجرم', lat: 36.95, lng: 56.38 },
      { name: 'فاروج', lat: 37.2306, lng: 58.2178 },
    ],
  },
  {
    name: 'خوزستان',
    lat: 31.3203,
    lng: 48.6692,
    cities: [
      { name: 'اهواز', lat: 31.3203, lng: 48.6692 },
      { name: 'آبادان', lat: 30.3392, lng: 48.3043 },
      { name: 'خرمشهر', lat: 30.4397, lng: 48.1894 },
      { name: 'دزفول', lat: 32.3814, lng: 48.4058 },
      { name: 'اندیمشک', lat: 32.46, lng: 48.3594 },
      { name: 'بهبهان', lat: 30.5959, lng: 50.2417 },
      { name: 'بندر ماهشهر', lat: 30.5589, lng: 49.1981 },
      { name: 'شوشتر', lat: 32.0455, lng: 48.8567 },
      { name: 'ایذه', lat: 31.8341, lng: 49.8671 },
      { name: 'رامهرمز', lat: 31.28, lng: 49.6029 },
      { name: 'مسجدسلیمان', lat: 31.9364, lng: 49.3039 },
      { name: 'شوش', lat: 32.1942, lng: 48.2436 },
      { name: 'سوسنگرد', lat: 31.5606, lng: 48.1839 },
    ],
  },
  {
    name: 'زنجان',
    lat: 36.6736,
    lng: 48.4787,
    cities: [
      { name: 'زنجان', lat: 36.6736, lng: 48.4787 },
      { name: 'ابهر', lat: 36.1469, lng: 49.218 },
      { name: 'خرمدره', lat: 36.2046, lng: 49.19 },
      { name: 'قیدار', lat: 36.12, lng: 48.59 },
      { name: 'ماه‌نشان', lat: 36.7522, lng: 47.6708 },
      { name: 'طارم', lat: 36.9569, lng: 48.8367 },
    ],
  },
  {
    name: 'سمنان',
    lat: 35.5729,
    lng: 53.3971,
    cities: [
      { name: 'سمنان', lat: 35.5729, lng: 53.3971 },
      { name: 'شاهرود', lat: 36.4182, lng: 54.9763 },
      { name: 'دامغان', lat: 36.1683, lng: 54.348 },
      { name: 'گرمسار', lat: 35.2182, lng: 52.3409 },
      { name: 'مهدی‌شهر', lat: 35.7, lng: 53.3556 },
      { name: 'سرخه', lat: 35.4628, lng: 53.2125 },
      { name: 'ایوانکی', lat: 35.3389, lng: 52.0717 },
    ],
  },
  {
    name: 'سیستان و بلوچستان',
    lat: 29.4963,
    lng: 60.8629,
    cities: [
      { name: 'زاهدان', lat: 29.4963, lng: 60.8629 },
      { name: 'زابل', lat: 31.0289, lng: 61.501 },
      { name: 'چابهار', lat: 25.2919, lng: 60.643 },
      { name: 'ایرانشهر', lat: 27.2025, lng: 60.6848 },
      { name: 'سراوان', lat: 27.3705, lng: 62.3348 },
      { name: 'خاش', lat: 28.2211, lng: 61.2158 },
      { name: 'کنارک', lat: 25.3597, lng: 60.3958 },
      { name: 'نیک‌شهر', lat: 26.2308, lng: 60.215 },
      { name: 'راسک', lat: 26.2386, lng: 61.3919 },
    ],
  },
  {
    name: 'فارس',
    lat: 29.5918,
    lng: 52.5837,
    cities: [
      { name: 'شیراز', lat: 29.5918, lng: 52.5837 },
      { name: 'مرودشت', lat: 29.8742, lng: 52.8025 },
      { name: 'جهرم', lat: 28.5, lng: 53.5606 },
      { name: 'فسا', lat: 28.9383, lng: 53.6482 },
      { name: 'کازرون', lat: 29.6191, lng: 51.654 },
      { name: 'داراب', lat: 28.7519, lng: 54.5444 },
      { name: 'لار', lat: 27.6814, lng: 54.3308 },
      { name: 'فیروزآباد', lat: 28.8438, lng: 52.571 },
      { name: 'آباده', lat: 31.1608, lng: 52.6506 },
      { name: 'نی‌ریز', lat: 29.1959, lng: 54.3284 },
      { name: 'اقلید', lat: 30.8939, lng: 52.6861 },
      { name: 'نورآباد ممسنی', lat: 30.11, lng: 51.52 },
    ],
  },
  {
    name: 'قزوین',
    lat: 36.2797,
    lng: 50.0049,
    cities: [
      { name: 'قزوین', lat: 36.2797, lng: 50.0049 },
      { name: 'تاکستان', lat: 36.0698, lng: 49.696 },
      { name: 'آبیک', lat: 36.0398, lng: 50.531 },
      { name: 'بوئین‌زهرا', lat: 35.7672, lng: 50.0586 },
      { name: 'الوند', lat: 36.19, lng: 50.07 },
      { name: 'محمدیه', lat: 36.155, lng: 50.1647 },
    ],
  },
  {
    name: 'قم',
    lat: 34.6416,
    lng: 50.8746,
    cities: [
      { name: 'قم', lat: 34.6416, lng: 50.8746 },
      { name: 'کهک', lat: 34.4006, lng: 50.8633 },
      { name: 'جعفریه', lat: 34.795, lng: 50.5436 },
      { name: 'دستجرد', lat: 34.5417, lng: 50.2417 },
      { name: 'قنوات', lat: 34.6481, lng: 51.0258 },
    ],
  },
  {
    name: 'کردستان',
    lat: 35.3219,
    lng: 46.9862,
    cities: [
      { name: 'سنندج', lat: 35.3219, lng: 46.9862 },
      { name: 'سقز', lat: 36.2492, lng: 46.2735 },
      { name: 'مریوان', lat: 35.5219, lng: 46.1759 },
      { name: 'بانه', lat: 35.9975, lng: 45.8853 },
      { name: 'بیجار', lat: 35.87, lng: 47.605 },
      { name: 'قروه', lat: 35.1664, lng: 47.805 },
      { name: 'کامیاران', lat: 34.7953, lng: 46.9356 },
      { name: 'دیواندره', lat: 35.9147, lng: 47.0228 },
    ],
  },
  {
    name: 'کرمان',
    lat: 30.2839,
    lng: 57.0834,
    cities: [
      { name: 'کرمان', lat: 30.2839, lng: 57.0834 },
      { name: 'سیرجان', lat: 29.452, lng: 55.6814 },
      { name: 'رفسنجان', lat: 30.4067, lng: 55.9939 },
      { name: 'جیرفت', lat: 28.6748, lng: 57.7367 },
      { name: 'بم', lat: 29.106, lng: 58.357 },
      { name: 'زرند', lat: 30.8126, lng: 56.564 },
      { name: 'شهربابک', lat: 30.1167, lng: 55.119 },
      { name: 'بافت', lat: 29.2333, lng: 56.6022 },
      { name: 'کهنوج', lat: 27.955, lng: 57.705 },
    ],
  },
  {
    name: 'کرمانشاه',
    lat: 34.3142,
    lng: 47.065,
    cities: [
      { name: 'کرمانشاه', lat: 34.3142, lng: 47.065 },
      { name: 'اسلام‌آباد غرب', lat: 34.11, lng: 46.5275 },
      { name: 'هرسین', lat: 34.2722, lng: 47.5861 },
      { name: 'سنقر', lat: 34.7847, lng: 47.6003 },
      { name: 'کنگاور', lat: 34.5042, lng: 47.9656 },
      { name: 'صحنه', lat: 34.4811, lng: 47.6914 },
      { name: 'پاوه', lat: 35.0436, lng: 46.3636 },
      { name: 'جوانرود', lat: 34.8081, lng: 46.4922 },
      { name: 'سرپل ذهاب', lat: 34.4608, lng: 45.8633 },
      { name: 'قصرشیرین', lat: 34.5158, lng: 45.5797 },
      { name: 'گیلانغرب', lat: 34.1428, lng: 45.9281 },
    ],
  },
  {
    name: 'کهگیلویه و بویراحمد',
    lat: 30.6682,
    lng: 51.588,
    cities: [
      { name: 'یاسوج', lat: 30.6682, lng: 51.588 },
      { name: 'دوگنبدان', lat: 30.3586, lng: 50.7981 },
      { name: 'دهدشت', lat: 30.7958, lng: 50.565 },
      { name: 'سی‌سخت', lat: 30.8636, lng: 51.4569 },
      { name: 'لیکک', lat: 30.5022, lng: 50.4283 },
      { name: 'چرام', lat: 30.7456, lng: 50.7325 },
    ],
  },
  {
    name: 'گلستان',
    lat: 36.8392,
    lng: 54.4347,
    cities: [
      { name: 'گرگان', lat: 36.8392, lng: 54.4347 },
      { name: 'گنبد کاووس', lat: 37.25, lng: 55.1672 },
      { name: 'علی‌آباد کتول', lat: 36.91, lng: 54.86 },
      { name: 'آق‌قلا', lat: 37.0167, lng: 54.45 },
      { name: 'کردکوی', lat: 36.7956, lng: 54.1108 },
      { name: 'بندر ترکمن', lat: 36.9, lng: 54.07 },
      { name: 'آزادشهر', lat: 37.0889, lng: 55.1736 },
      { name: 'مینودشت', lat: 37.23, lng: 55.3744 },
      { name: 'کلاله', lat: 37.3833, lng: 55.49 },
      { name: 'رامیان', lat: 37.0153, lng: 55.1428 },
    ],
  },
  {
    name: 'گیلان',
    lat: 37.2808,
    lng: 49.5832,
    cities: [
      { name: 'رشت', lat: 37.2808, lng: 49.5832 },
      { name: 'بندر انزلی', lat: 37.472, lng: 49.4622 },
      { name: 'لاهیجان', lat: 37.2071, lng: 50.0036 },
      { name: 'لنگرود', lat: 37.1972, lng: 50.1547 },
      { name: 'آستارا', lat: 38.429, lng: 48.872 },
      { name: 'رودسر', lat: 37.1378, lng: 50.289 },
      { name: 'صومعه‌سرا', lat: 37.3119, lng: 49.3225 },
      { name: 'فومن', lat: 37.224, lng: 49.3122 },
      { name: 'تالش', lat: 37.8, lng: 48.9 },
      { name: 'آستانه اشرفیه', lat: 37.26, lng: 49.9442 },
      { name: 'رودبار', lat: 36.8181, lng: 49.4264 },
    ],
  },
  {
    name: 'لرستان',
    lat: 33.4878,
    lng: 48.3558,
    cities: [
      { name: 'خرم‌آباد', lat: 33.4878, lng: 48.3558 },
      { name: 'بروجرد', lat: 33.8973, lng: 48.7516 },
      { name: 'دورود', lat: 33.4989, lng: 49.0589 },
      { name: 'الیگودرز', lat: 33.4006, lng: 49.6947 },
      { name: 'کوهدشت', lat: 33.535, lng: 47.6072 },
      { name: 'ازنا', lat: 33.4556, lng: 49.4556 },
      { name: 'نورآباد دلفان', lat: 34.0728, lng: 47.9656 },
      { name: 'پلدختر', lat: 33.1547, lng: 47.7106 },
      { name: 'الشتر', lat: 33.8639, lng: 48.2611 },
    ],
  },
  {
    name: 'مازندران',
    lat: 36.5633,
    lng: 53.0601,
    cities: [
      { name: 'ساری', lat: 36.5633, lng: 53.0601 },
      { name: 'بابل', lat: 36.5513, lng: 52.679 },
      { name: 'آمل', lat: 36.47, lng: 52.35 },
      { name: 'قائم‌شهر', lat: 36.4631, lng: 52.86 },
      { name: 'بابلسر', lat: 36.7025, lng: 52.6575 },
      { name: 'چالوس', lat: 36.655, lng: 51.42 },
      { name: 'نوشهر', lat: 36.6486, lng: 51.4969 },
      { name: 'تنکابن', lat: 36.8163, lng: 50.8738 },
      { name: 'بهشهر', lat: 36.6922, lng: 53.5519 },
      { name: 'نکا', lat: 36.6517, lng: 53.2992 },
      { name: 'رامسر', lat: 36.9036, lng: 50.6581 },
      { name: 'محمودآباد', lat: 36.63, lng: 52.26 },
      { name: 'نور', lat: 36.5739, lng: 52.0103 },
    ],
  },
  {
    name: 'مرکزی',
    lat: 34.0917,
    lng: 49.6892,
    cities: [
      { name: 'اراک', lat: 34.0917, lng: 49.6892 },
      { name: 'ساوه', lat: 35.0213, lng: 50.3566 },
      { name: 'خمین', lat: 33.6386, lng: 50.0789 },
      { name: 'محلات', lat: 33.9078, lng: 50.4561 },
      { name: 'دلیجان', lat: 33.9906, lng: 50.6847 },
      { name: 'شازند', lat: 33.9272, lng: 49.4117 },
      { name: 'تفرش', lat: 34.6925, lng: 50.0136 },
      { name: 'مأمونیه', lat: 35.4203, lng: 50.4856 },
    ],
  },
  {
    name: 'هرمزگان',
    lat: 27.1865,
    lng: 56.2808,
    cities: [
      { name: 'بندرعباس', lat: 27.1865, lng: 56.2808 },
      { name: 'میناب', lat: 27.1467, lng: 57.08 },
      { name: 'بندر لنگه', lat: 26.5579, lng: 54.8807 },
      { name: 'قشم', lat: 26.9581, lng: 56.2719 },
      { name: 'کیش', lat: 26.5578, lng: 53.9803 },
      { name: 'بستک', lat: 27.2, lng: 54.3667 },
      { name: 'جاسک', lat: 25.644, lng: 57.774 },
      { name: 'حاجی‌آباد', lat: 28.3167, lng: 55.9 },
      { name: 'رودان', lat: 27.4422, lng: 57.1817 },
    ],
  },
  {
    name: 'همدان',
    lat: 34.7992,
    lng: 48.5146,
    cities: [
      { name: 'همدان', lat: 34.7992, lng: 48.5146 },
      { name: 'ملایر', lat: 34.2969, lng: 48.8233 },
      { name: 'نهاوند', lat: 34.1889, lng: 48.3767 },
      { name: 'تویسرکان', lat: 34.5497, lng: 48.4456 },
      { name: 'اسدآباد', lat: 34.7822, lng: 48.1186 },
      { name: 'بهار', lat: 34.9081, lng: 48.4406 },
      { name: 'کبودرآهنگ', lat: 35.2103, lng: 48.7244 },
      { name: 'رزن', lat: 35.3858, lng: 49.0353 },
    ],
  },
  {
    name: 'یزد',
    lat: 31.8974,
    lng: 54.3569,
    cities: [
      { name: 'یزد', lat: 31.8974, lng: 54.3569 },
      { name: 'اردکان', lat: 32.31, lng: 54.0175 },
      { name: 'میبد', lat: 32.215, lng: 54.0166 },
      { name: 'بافق', lat: 31.6053, lng: 55.4153 },
      { name: 'مهریز', lat: 31.5908, lng: 54.4319 },
      { name: 'تفت', lat: 31.7464, lng: 54.2069 },
      { name: 'ابرکوه', lat: 31.1306, lng: 53.2667 },
      { name: 'اشکذر', lat: 31.9961, lng: 54.2589 },
    ],
  },
];

/** All province names (for quick validation / select options). */
export const provinceNames: string[] = iranProvinces.map((p) => p.name);

const byProvince = new Map(iranProvinces.map((p) => [p.name, p]));

/** Look up a province by exact name. */
export function findProvince(name?: string | null): GeoProvince | undefined {
  return name ? byProvince.get(name.trim()) : undefined;
}

/** Whether `city` is a known city of `province` (exact names). */
export function isValidProvinceCity(province?: string | null, city?: string | null): boolean {
  const p = findProvince(province);
  if (!p || !city) return false;
  const c = city.trim();
  return p.cities.some((x) => x.name === c);
}

/** Center coordinates of a city (for the map starting point). null if unknown. */
export function cityCoords(
  province?: string | null,
  city?: string | null,
): { lat: number; lng: number } | null {
  const p = findProvince(province);
  if (!p || !city) return null;
  const c = p.cities.find((x) => x.name === city.trim());
  return c ? { lat: c.lat, lng: c.lng } : null;
}

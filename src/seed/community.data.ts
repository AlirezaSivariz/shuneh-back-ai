import type { CommunityQuestionCategory } from '../models/CommunityQuestion';

/**
 * Demo content for the community Q&A forum. All content is authored by NORMAL
 * (non-specialist) demo users — deliberately no fake «specialists». Seeding is
 * idempotent: questions/answers are keyed by `seedKey` and only ever INSERTED
 * (never overwrite live user edits/likes).
 *
 * The 14 questions (2 per category) × 3 answers give the forum a lived-in feel
 * on a fresh database while staying safe to re-run on every boot.
 */

export interface SeedCommunityUser {
  key: string;
  phone: string;
  firstName: string;
  lastName: string;
}

export interface SeedCommunityAnswer {
  seedKey: string;
  authorKey: string;
  content: string;
  /** «پاسخ برگزیده» — marked on the best answer of each seeded question. */
  isVerifiedAnswer?: boolean;
  daysAgo: number;
}

export interface SeedCommunityQuestion {
  seedKey: string;
  category: CommunityQuestionCategory;
  title: string;
  content: string;
  authorKey: string;
  daysAgo: number;
  viewCount: number;
  /** Demo users who already liked this question (seed like-count consistency). */
  likeKeys: string[];
  /** Demo users who already saved this question. */
  saveKeys: string[];
  answers: SeedCommunityAnswer[];
}

export const SEED_COMMUNITY_USERS: SeedCommunityUser[] = [
  { key: 'sara', phone: '+989100000001', firstName: 'سارا', lastName: 'محمدی' },
  { key: 'niloofar', phone: '+989100000002', firstName: 'نیلوفر', lastName: 'حیدری' },
  { key: 'mahsa', phone: '+989100000003', firstName: 'مهسا', lastName: 'کریمی' },
  { key: 'amir', phone: '+989100000004', firstName: 'امیر', lastName: 'رضایی' },
  { key: 'reza', phone: '+989100000005', firstName: 'رضا', lastName: 'احمدی' },
  { key: 'ali', phone: '+989100000006', firstName: 'علی', lastName: 'حسینی' },
  { key: 'maryam', phone: '+989100000007', firstName: 'مریم', lastName: 'احمدی' },
  { key: 'zahra', phone: '+989100000008', firstName: 'زهرا', lastName: 'رضایی' },
  { key: 'mina', phone: '+989100000009', firstName: 'مینا', lastName: 'صادقی' },
  { key: 'hamed', phone: '+989100000010', firstName: 'حامد', lastName: 'کریمی' },
  { key: 'elham', phone: '+989100000011', firstName: 'الهام', lastName: 'مرادی' },
  { key: 'parisa', phone: '+989100000012', firstName: 'پریسا', lastName: 'کاظمی' },
  { key: 'yasmin', phone: '+989100000013', firstName: 'یاسمین', lastName: 'رحیمی' },
];

export const SEED_COMMUNITY_QUESTIONS: SeedCommunityQuestion[] = [
  // ── سالن زیبایی ──
  {
    seedKey: 'q1',
    category: 'salon',
    title: 'نظافت و ضدعفونی ابزار توی سالن‌ها چطور انجام میشه؟',
    content:
      'سلام. میخوام بدونم سالن‌های زیبایی ابزارها (قیچی، برس، بیکینی، تیغ و…) رو بین هر مشتری چطور ضدعفونی میکنن؟ برای انتخاب سالن چه نکاتی رو باید چک کنم؟',
    authorKey: 'sara',
    daysAgo: 2,
    viewCount: 342,
    likeKeys: ['reza', 'maryam', 'elham'],
    saveKeys: ['zahra'],
    answers: [
      {
        seedKey: 'q1-a1',
        authorKey: 'reza',
        isVerifiedAnswer: true,
        daysAgo: 1.6,
        content:
          'سلام. سالن‌های معتبر معمولاً بعد از هر مشتری ابزارها رو با محلول‌های ضدعفونی مخصوص (مثل الکل ۷۰٪ یا مواد حاوی کلرهگزیدین) تمیز میکنن و تیغ و فایل‌های مصرفی رو برای هر نفر جدا میذارن. موقع انتخاب، از سرویس بهداشتی و محل استریل ابزار دیدن کنین؛ اگه ظرف محلول ضدعفونی سر میز دیده بشه و تیغ یکبارمصرف باز بشه، نشونه خوبیه.',
      },
      {
        seedKey: 'q1-a2',
        authorKey: 'maryam',
        daysAgo: 1.1,
        content:
          'من چند ساله میرم سالن ثابت و همیشه ازشون می‌پرسم. یه نکته مهم: حوله‌ها حتماً باید بین مشتری‌ها عوض بشه و وسایل بعد از هر کار توی دستگاه UV یا بخار قرار بگیره. اگه جوابشون قانع‌کننده نبود، سالن عوض کنین.',
      },
      {
        seedKey: 'q1-a3',
        authorKey: 'elham',
        daysAgo: 0.6,
        content:
          'ضمناً این نکته رو اضافه کنم که کاشت ناخن و پدیکور حساسترینه. حتماً بپرسین تیغچه و بافر ناخن برای هر نفر جداست و صندلی و وان پدیکور ضدعفونی میشه. این‌ها خیلی مهم‌تر از ظاهر شیک سالنه.',
      },
    ],
  },
  {
    seedKey: 'q2',
    category: 'salon',
    title: 'برای پیدا کردن سالن زیبایی خوب توی یه شهر دیگه چیکار کنم؟',
    content:
      'قراره چند ماهی برم یه شهر دیگه و دنبال سالن زیبایی مطمئن می‌گردم. از کجا بفهمم یه سالن خوبه و ریسک نکنم؟',
    authorKey: 'niloofar',
    daysAgo: 5,
    viewCount: 156,
    likeKeys: ['amir', 'mina', 'parisa'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q2-a1',
        authorKey: 'amir',
        isVerifiedAnswer: true,
        daysAgo: 4.5,
        content:
          'بهترین راه اینه که دنبال سالن‌هایی بگردی که نظرات واقعی و عکس کارشون رو آنلاین گذاشتن. توی پلتفرم شونه می‌تونی متخصص رو از روی نظرات، امتیاز و نمونه‌کارها انتخاب کنی و همین آنلاین نوبت بگیری.',
      },
      {
        seedKey: 'q2-a2',
        authorKey: 'mina',
        daysAgo: 3.8,
        content:
          'من توی شهر جدید اول یه مدل ساده (مثل کوتاهی یا براشینگ) از سالن می‌گیرم. اگه کیفیت و برخورد خوب بود، بعدش خدمات گرون‌تر مثل رنگ و کراتین رو بهشون می‌سپارم. ریسکش خیلی کمتره.',
      },
      {
        seedKey: 'q2-a3',
        authorKey: 'parisa',
        daysAgo: 3,
        content:
          'نظرات کاربران رو بخون و ببین آدمایی که تجربه مشابه تو (مثلاً موی فر یا پوست حساس) داشتن چی گفتن. سوالاتت رو هم از قبل توی پشتیبانی یا واتساپ سالن بپرس تا مطمئن شی.',
      },
    ],
  },

  // ── مدل مو ترند ──
  {
    seedKey: 'q3',
    category: 'hair-trend',
    title: 'ترند رنگ مو و هایلایت سال جدید چیه؟',
    content:
      'می‌خوام قبل از عید موهامو یه کار جدید بکنم. امسال چه رنگ‌ها و تکنیک‌هایی ترنده؟ بین بالیاژ و امبره کدومو پیشنهاد می‌دین؟',
    authorKey: 'mahsa',
    daysAgo: 3,
    viewCount: 289,
    likeKeys: ['elham', 'zahra', 'reza'],
    saveKeys: ['mina'],
    answers: [
      {
        seedKey: 'q3-a1',
        authorKey: 'elham',
        isVerifiedAnswer: true,
        daysAgo: 2.5,
        content:
          'این چند ساله بالیاژ و «موکا ملت» (قهوه‌ای گرم با سایه‌های کاراملی) خیلی پرطرفدار شده. رنگ‌های عسلی و طلایی برای پوست‌های گندمی و رنگ‌های بادمجانی و شکلاتی برای پوست‌های روشن عالی درمیان.',
      },
      {
        seedKey: 'q3-a2',
        authorKey: 'zahra',
        daysAgo: 1.8,
        content:
          'بستگی به فرم و وضعیت موهات داره. اگه موهات نازکه، بالیاژ ملایم با تناژ گرم بهتره چون کمترین آسیب و بالاترین حجم بصری رو داره. امبره برای موهای بلند و پرپشت جواب می‌ده.',
      },
      {
        seedKey: 'q3-a3',
        authorKey: 'reza',
        daysAgo: 1.2,
        content:
          'اگه پوستت گرمه سراغ تناژهای نارنجی-طلایی و اگه پوستت سرده سراغ تناژهای خاکستری-نقره‌ای برو. مهم‌تر از ترند، رنگیه که با رنگ پوست و چشمت هماهنگ باشه؛ از آرایشگرت بخو دم‌روتین جلوه بده.',
      },
    ],
  },
  {
    seedKey: 'q4',
    category: 'hair-trend',
    title: 'فر مو یا شینیون؟ برای عروسی کدوم رو انتخاب کنم؟',
    content:
      'عروسی خودمه و بین فر دائم، شینیون و حالت مو موندم. موهام نیمه‌بلنده و طبیعی صافن. چی به صورتم بیشتر میاد و کدوم موندگاری بیشتری داره؟',
    authorKey: 'elham',
    daysAgo: 7,
    viewCount: 201,
    likeKeys: ['sara', 'maryam', 'hamed'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q4-a1',
        authorKey: 'sara',
        isVerifiedAnswer: true,
        daysAgo: 6.4,
        content:
          'برای عروسی شینیون گزینه امن‌تره؛ هم موندگاریش تا آخر شب می‌مونه هم رسمی‌تر و شیک‌تره. اگه دوست داری موهات رها باشه، یه شینیون نیمه‌بسته (نصف رها) انتخاب کن.',
      },
      {
        seedKey: 'q4-a2',
        authorKey: 'maryam',
        daysAgo: 5.6,
        content:
          'فر موندگاریش معمولاً ۶ تا ۱۲ ساعته و اگه موی خیلی صاف داری شاید تا آخر مراسم باز بشه. من پیشنهاد می‌کنم با مشاوره آرایشگر، مدلی انتخاب کنی که با فرم صورت و یقه لباست هماهنگ باشه.',
      },
      {
        seedKey: 'q4-a3',
        authorKey: 'hamed',
        daysAgo: 4.8,
        content:
          'نکته مهم: قبل از تصمیم، یه «تست» با همون مدل انجام بده و عکس بنداز. مدلی که توی سلفی و عکس از جلو و پهلو خوب درمیاد، برنده‌ست. شینیون جمع‌وجور برای صورت گرد و فر رها برای صورت کشیده مناسب‌تره.',
      },
    ],
  },

  // ── ناخن ──
  {
    seedKey: 'q5',
    category: 'nails',
    title: 'آیا کاشت ناخن به سلامت ناخن آسیب میزنه؟',
    content:
      'چند بار کاشت ناخن انجام دادم ولی شنیدم ممکنه به ناخنم آسیب بزنه. چطور بفهمم ناخنم در خطره و راهکار جایگزین چیه؟',
    authorKey: 'maryam',
    daysAgo: 1,
    viewCount: 410,
    likeKeys: ['niloofar', 'mina', 'yasmin'],
    saveKeys: ['parisa'],
    answers: [
      {
        seedKey: 'q5-a1',
        authorKey: 'niloofar',
        isVerifiedAnswer: true,
        daysAgo: 0.8,
        content:
          'اگه کاشت با مواد باکیفیت و توسط متخصص انجام بشه و بین هر دوره استراحت بدی، معمولاً خطر جدی نداره. مهم‌ترینش اینه که زیاد سوهان زده نشه و پرایمر اسیدی استفاده نشه؛ ناخن نباید درد بگیره.',
      },
      {
        seedKey: 'q5-a2',
        authorKey: 'mina',
        daysAgo: 0.5,
        content:
          'من ۲ سال کاشت کردم و با رعایت استراحت یه ماهه بین هر دوره، ناخنم سالم موند. از لاک‌های تقویتی و روغن کوتیکول غافل نشو.',
      },
      {
        seedKey: 'q5-a3',
        authorKey: 'yasmin',
        daysAgo: 0.25,
        content:
          'اگه ناخنت نازک یا شکننده‌ست، فعلاً کاشت نکن؛ اول با تقویت‌کننده و ویتامین ناخن رو درست کن. می‌تونی جایگزین از «کاشت ژل» سبک یا مانیکور ساده با لاک تقویتی استفاده کنی.',
      },
    ],
  },
  {
    seedKey: 'q6',
    category: 'nails',
    title: 'فرق کاشت پودر، ژل و پلی‌ژل چیه و کدوم موندگاری بیشتری داره؟',
    content:
      'توی سالن‌ها می‌گن کاشت پودر، کاشت ژل و پلی‌ژل. نمی‌دونم فرقشون چیه و کدوم برای دست خودم بهتره. میشه راهنماییم کنین؟',
    authorKey: 'parisa',
    daysAgo: 9,
    viewCount: 122,
    likeKeys: ['sara', 'elham', 'ali'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q6-a1',
        authorKey: 'sara',
        isVerifiedAnswer: true,
        daysAgo: 8.3,
        content:
          'کاشت پودر (اکریلیک) سخت‌تره و موندگاریش بیشتره ولی چربیه دست و قالبش طبیعی‌تر نیست. ژل سبک‌تر و طبیعی‌تره ولی موندگاری کمتری داره. پلی‌ژل وسطِ این دوتاست؛ نیمه‌سخت و سبک و موندگاری خوبی داره.',
      },
      {
        seedKey: 'q6-a2',
        authorKey: 'elham',
        daysAgo: 7.5,
        content:
          'برای استفاده روزمره و اینکه ضخامت اضافه اذیتت نکنه، پلی‌ژل پیشنهاد منه. اگه ناخنت خیلی کوتاهه یا عادت داری با دست کار زیاد بکنی، پودر موندگارتره.',
      },
      {
        seedKey: 'q6-a3',
        authorKey: 'ali',
        daysAgo: 6.6,
        content:
          'هر کدوم اگه درست انجام بشه ۳ تا ۴ هفته می‌مونه. ملاک اصلی مهارت تکنسینه نه نوع مواد؛ یه کاشت ژل خوب از کاشت پودر بد بهتره.',
      },
    ],
  },

  // ── مو مردانه ──
  {
    seedKey: 'q7',
    category: 'mens',
    title: 'بهترین مدل فید و کوتاهی مو برای صورت گرد چیه؟',
    content:
      'صورت گرد دارم و می‌خوام موهامو عوض کنم. چه مدل کوتاهی و فیدی پیشنهاد می‌دین که صورتم کشیده‌تر دیده بشه؟',
    authorKey: 'hamed',
    daysAgo: 4,
    viewCount: 268,
    likeKeys: ['amir', 'reza', 'zahra'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q7-a1',
        authorKey: 'amir',
        isVerifiedAnswer: true,
        daysAgo: 3.5,
        content:
          'فید بالا با حجم کم توی طرفین (فید ۰ یا ۱) و کوتاهی متوسط روی سر، صورت رو کشیده‌تر نشون می‌ده. از موهای خیلی پرپشت و بلند توی پهلو خودداری کن.',
      },
      {
        seedKey: 'q7-a2',
        authorKey: 'reza',
        daysAgo: 2.7,
        content:
          'یه مدل کلاسیک خوب: کراپ با تکسچر روی سر و فید کناره. ریش کوتاه و مرتب هم خط فک رو برجسته‌تر می‌کنه.',
      },
      {
        seedKey: 'q7-a3',
        authorKey: 'zahra',
        daysAgo: 1.9,
        content:
          'اگر دوست داری قد مو بالا باشه، حجم رو به سمت بالا بده (نه پهلو). موی بلند کنار گوش برای صورت گرد اصلاً جواب نمی‌ده.',
      },
    ],
  },
  {
    seedKey: 'q8',
    category: 'mens',
    title: 'موی سفید و جوگندمی؛ رنگ کنم یا نه؟',
    content:
      '۳۵ سالمه و موهام جوگندمی شده. بهم گفتن رنگ کردن موی مردانه به مرور زشته میشه. نظر شما چیه و چیکار کنم طبیعی بمونه؟',
    authorKey: 'ali',
    daysAgo: 11,
    viewCount: 98,
    likeKeys: ['hamed', 'yasmin', 'maryam'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q8-a1',
        authorKey: 'hamed',
        isVerifiedAnswer: true,
        daysAgo: 10.2,
        content:
          'رنگ کردن موی مردانه اگه هر ۳-۴ هفته ریشه انجام بدی هیچ زشتی نداره. رنگ‌های خیلی تیره و مشکی رو انتخاب نکن؛ یه تن قهوه‌ای یا خاکستری که به رنگ طبیعیت نزدیکه، طبیعی‌تر درمیاد.',
      },
      {
        seedKey: 'q8-a2',
        authorKey: 'yasmin',
        daysAgo: 9.4,
        content:
          'گزینه دیگه اینه که اصلاً رنگ نکنی و جوگندمی رو با یه کوتاهی مرتب و ریش کوتاه بپذیری؛ خیلی از آقایون این استایل رو شیک‌تر دوست دارن. اگه مطمئن نیستی، اول یه رنگ موقت ۱-۲ هفته‌ای تست کن.',
      },
      {
        seedKey: 'q8-a3',
        authorKey: 'maryam',
        daysAgo: 8.5,
        content:
          'مهمه موهات خشک نشه؛ سفید شدن مو یعنی ملانین کمتر و موی خشک‌تر. از شامپوی ملایم و نرم‌کننده استفاده کن و نور آفتاب مستقیم کمتر به موهات بخوره.',
      },
    ],
  },

  // ── مشکلات مو ──
  {
    seedKey: 'q9',
    category: 'hair-problems',
    title: 'ریزش مو بعد از کراتین طبیعی هست یا آسیب زده؟',
    content:
      'دو هفته پیش کراتین کردم و الان موقع شستشو موهام بیشتر از قبل می‌ریزه. آیا این طبیعیه یا کراتین به موهام آسیب زده؟',
    authorKey: 'mina',
    daysAgo: 6,
    viewCount: 331,
    likeKeys: ['sara', 'niloofar', 'hamed'],
    saveKeys: ['mahsa'],
    answers: [
      {
        seedKey: 'q9-a1',
        authorKey: 'sara',
        isVerifiedAnswer: true,
        daysAgo: 5.4,
        content:
          'چند هفته اول بعد از کراتین ریزش کمی طبیعیه چون موی ضعیف و در حال شکستن موقع پروتئین درمانی جدا میشه. ولی اگه ریزش شدید بود یا کف سرت می‌سوخت، حتماً به متخصص پوست مراجعه کن.',
      },
      {
        seedKey: 'q9-a2',
        authorKey: 'niloofar',
        daysAgo: 4.6,
        content:
          'باید مطمئن شی از محلول فرمالدئید آزاد استفاده شده باشه؛ بعضی کراتین‌های ارزون مواد شیمیایی قوی دارن که به فولیکول آسیب می‌زنه. از آرایشگرت بپرس چه برندی و با چه مدرکی زده.',
      },
      {
        seedKey: 'q9-a3',
        authorKey: 'hamed',
        daysAgo: 3.7,
        content:
          'مواظب باش با برس یا کش موهای کراتین‌شده رو زیاد نکشی. تا یه ماه از شامپوی بدون سولفات استفاده کن و شانه زدن رو با نرم‌کننده انجام بده تا ریزش مکانیکی کم بشه.',
      },
    ],
  },
  {
    seedKey: 'q10',
    category: 'hair-problems',
    title: 'شوره سر چراش زیاده و چطور درمانش کنم؟',
    content:
      'دوساله شوره شدید دارم و خیلی خجالت می‌کشم. شامپوهای ضدشوره هم امتحان کردم ولی فایده نکرده. چیکار کنم؟',
    authorKey: 'yasmin',
    daysAgo: 13,
    viewCount: 87,
    likeKeys: ['reza', 'maryam', 'ali'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q10-a1',
        authorKey: 'reza',
        isVerifiedAnswer: true,
        daysAgo: 12.3,
        content:
          'شوره شدید و مقاوم به درمان معمولاً «سبرئیک درماتیت» یا قارچ مالاسزیاست و باید با شامپوی طبی (مثل کتوکونازول یا زینک پیریتیون) طبق دستور متخصص پوست درمان بشه؛ خودسرانه ادامه نده.',
      },
      {
        seedKey: 'q10-a2',
        authorKey: 'maryam',
        daysAgo: 11.4,
        content:
          'رژیم غذایی و استرس هم خیلی اثر داره. روغن نارگیل یا آلوئه‌ورا برای رفع خشکی کف سر خوبه ولی اگه شوره از نوع چربیه، شاید بدترش کنه. حتماً اول نوع شوره‌ات رو مشخص کن.',
      },
      {
        seedKey: 'q10-a3',
        authorKey: 'ali',
        daysAgo: 10.5,
        content:
          'توی سالن ازتون می‌پرسم که قبل از هر خدمتی کف سرت رو چک کنن و اگه ضایعه التهابی دیده بشه، اون روز شستشو/حالت ندن. درمان شوره زمان‌بره؛ ۴-۶ هفته صبور باش و منظم شامپو بزن.',
      },
    ],
  },

  // ── پوست و زیبایی ──
  {
    seedKey: 'q11',
    category: 'skin',
    title: 'روش صحیح پاک کردن آرایش صورت چیه که پوست اذیت نشه؟',
    content:
      'همیشه موقع پاک کردن آرایش چشم و صورتم قرمز و خشک میشه. بهترین روش چیه و چه محصولاتی بهترن؟',
    authorKey: 'elham',
    daysAgo: 2,
    viewCount: 523,
    likeKeys: ['sara', 'mina', 'niloofar'],
    saveKeys: ['elham'],
    answers: [
      {
        seedKey: 'q11-a1',
        authorKey: 'sara',
        isVerifiedAnswer: true,
        daysAgo: 1.7,
        content:
          'اول با «پاک‌کننده روغنی» یا بام آب چشمی آرایش رو حل کن، بعد با شوینده ملایم صورت رو بشور و در آخر تونر و مرطوب‌کننده بزن. با دستمال مرطوب شدید نمال؛ پوستت رو نکش.',
      },
      {
        seedKey: 'q11-a2',
        authorKey: 'mina',
        daysAgo: 1,
        content:
          'اگر چشم‌هات حساسه از پدهای نخی و پاک‌کننده مخصوص چشم استفاده کن و پد رو چند ثانیه روی چشم نگه دار تا آرایش حل بشه بعد پاک کن. شستن با آب سرد هم قرمزی رو کم می‌کنه.',
      },
      {
        seedKey: 'q11-a3',
        authorKey: 'niloofar',
        daysAgo: 0.4,
        content:
          'پوستت احتمالاً سد دفاعیش ضعیفه؛ یه شب در میون فقط با آب و شوینده ملایم بشور و صبح‌ها کرم ضدآفتاب فراموش نشه. لایه‌برداری فیزیکی رو موقتاً حذف کن.',
      },
    ],
  },
  {
    seedKey: 'q12',
    category: 'skin',
    title: 'میکاپ دائمی (تاتوی ابرو و لب) ارزشش رو داره یا ریسک داره؟',
    content:
      'به تاتوی ابرو و هاشور فکر می‌کنم ولی می‌ترسم خراب بشه یا واکنش پوستی بدم. نظرتون چیه؟',
    authorKey: 'zahra',
    daysAgo: 8,
    viewCount: 143,
    likeKeys: ['parisa', 'maryam', 'hamed'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q12-a1',
        authorKey: 'parisa',
        isVerifiedAnswer: true,
        daysAgo: 7.2,
        content:
          'اگه سالن معتبر، تاتوکار دارای مدرک معتبر و ابزار یکبارمصرف داشته باشه، ریسکش پایینه. قبلش حتماً تست پچ بزن و نمونه‌کارهای واقعی (نه روتوش‌شده) رو ببین.',
      },
      {
        seedKey: 'q12-a2',
        authorKey: 'maryam',
        daysAgo: 6.5,
        content:
          'فرق مهم بین «تاتو» و «میکروپیگمنتیشن» رو بدون؛ میکروپیگمنتیشن سطحی‌تره و رنگش بعد ۱-۲ سال محو میشه و برای ابرو طبیعیه. حتماً از جوهر استاندارد و ضدحساسیت استفاده بشه.',
      },
      {
        seedKey: 'q12-a3',
        authorKey: 'hamed',
        daysAgo: 5.8,
        content:
          'اگه پوستت مستعد جوشه یا سابقه اسکار داره، حتماً با متخصص پوست مشورت کن. بعد از انجام هم ضدآفتاب و مرطوب‌کننده به محل تاتو بزن تا رنگ پوسته پوسته نشه.',
      },
    ],
  },

  // ── رزرو و خدمات ──
  {
    seedKey: 'q13',
    category: 'booking',
    title: 'چطور آنلاین نوبت بگیرم و هزینه رو از کجا بفهمم؟',
    content:
      'اولین باره می‌خوام آنلاین برای آرایشگاه نوبت بگیرم. از کجا باید شروع کنم؟ هزینه خدمات از قبل مشخصه یا موقع مراجعه می‌فهمم؟',
    authorKey: 'reza',
    daysAgo: 3,
    viewCount: 176,
    likeKeys: ['amir', 'sara', 'niloofar'],
    saveKeys: ['mahsa'],
    answers: [
      {
        seedKey: 'q13-a1',
        authorKey: 'amir',
        isVerifiedAnswer: true,
        daysAgo: 2.4,
        content:
          'توی شونه اول خدمت موردنظرت (مثلاً کوتاهی یا رنگ مو) رو جستجو کن، متخصص و سالن موردنظرت رو انتخاب کن و از بین زمان‌های خالی یه وقت بردار. قیمت هر خدمت رو همونجا می‌بینی و نوبتت فوری تایید میشه.',
      },
      {
        seedKey: 'q13-a2',
        authorKey: 'sara',
        daysAgo: 1.7,
        content:
          'بیشتر سالن‌ها قیمت پایه خدمت رو مشخص می‌کنن؛ اگه خدمت سفارشی بخوای (مثلاً رنگ خاص یا کار اضافه) ممکنه هزینه کمی تغییر کنه که قبل از شروع کار بهت می‌گن. موقع رزرو همیشه توضیحات سالن رو بخون.',
      },
      {
        seedKey: 'q13-a3',
        authorKey: 'niloofar',
        daysAgo: 1.1,
        content:
          'قبل از نوبت، با متخصص درباره زمان موردنیاز و هزینه نهایی صحبت کن. توی شونه می‌تونی نظرات و امتیاز مشتریای قبلی رو هم ببینی تا انتخاب بهتری داشته باشی.',
      },
    ],
  },
  {
    seedKey: 'q14',
    category: 'booking',
    title: 'اگه نوبتم لغو بشه یا دیر برسم چی میشه؟',
    content:
      'چندبار پیش اومده سر نوبت نمی‌رسم یا مجبورم کنسل کنم. قوانین لغو و تاخیر توی این پلتفرم چیه؟ جریمه داره؟',
    authorKey: 'amir',
    daysAgo: 10,
    viewCount: 118,
    likeKeys: ['hamed', 'yasmin', 'reza'],
    saveKeys: [],
    answers: [
      {
        seedKey: 'q14-a1',
        authorKey: 'hamed',
        isVerifiedAnswer: true,
        daysAgo: 9.2,
        content:
          'قوانین لغو معمولاً توی صفحه هر متخصص و موقع رزرو نوشته شده؛ هر سالن سیاست خودشو داره. اگه زودتر از ۲۴ ساعت قبل لغو کنی معمولاً بدون جریمست، ولی لغو دیروقت یا نرفتن ممکنه جریمه داشته باشه.',
      },
      {
        seedKey: 'q14-a2',
        authorKey: 'yasmin',
        daysAgo: 8.4,
        content:
          'بهترین کار اینه که اگر مطمئن نیستی می‌رسی، نوبت رو چند ساعت قبل کنسل کنی تا جای تو برای مشتری دیگه خالی بمونه. این‌طوری هم به متخصص احترام می‌ذاری هم جریمه نمی‌شی.',
      },
      {
        seedKey: 'q14-a3',
        authorKey: 'reza',
        daysAgo: 7.6,
        content:
          'توی شونه برای لغو نوبت کافیه از بخش رزروها اقدام کنی و وضعیت نوبتت رو اونجا ببینی. دیر رسیدن هم به متخصص اطلاع بده؛ بعضی وقتا می‌تونن نوبتت رو جابجا کنن.',
      },
    ],
  },
];

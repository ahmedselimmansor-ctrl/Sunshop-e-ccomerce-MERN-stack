/**
 * Seed catalogue.
 *
 * Kept separate from the seed script so the data is reviewable on its own and
 * the script stays about *how* it loads rather than *what* it loads.
 *
 * Photography comes from Unsplash, referenced by photo id. The seeder downloads
 * each one and uploads it to the project's own object storage (MinIO locally,
 * S3 in AWS), so the storefront serves images from its own CDN exactly as it
 * would in production rather than hotlinking a third party. Every id below was
 * checked against the subject it is attached to, so a headphone photo never
 * ends up on a dress.
 */

export interface SeedOptionValue {
  code: string;
  en: string;
  ar: string;
  swatch?: string;
}

export interface SeedOption {
  code: string;
  en: string;
  ar: string;
  values: SeedOptionValue[];
}

export interface SeedProduct {
  en: string;
  ar: string;
  brand: string;
  /** Matches a category's English name in CATEGORY_TREE. */
  category: string;
  /** Minor units, e.g. 24900 is 249.00. */
  price: number;
  compareAt?: number;
  descEn: string;
  descAr: string;
  /** Unsplash photo ids, first one is the primary image. */
  images: string[];
  tags: string[];
  options?: SeedOption[];
  featured?: boolean;
  soldCount?: number;
  rating?: number;
}

export interface SeedCategory {
  en: string;
  ar: string;
  image?: string;
  children?: SeedCategory[];
}

// ── Reusable option axes ────────────────────────────────────────────────────

const APPAREL_SIZES: SeedOption = {
  code: 'size',
  en: 'Size',
  ar: 'المقاس',
  values: [
    { code: 'S', en: 'S', ar: 'صغير' },
    { code: 'M', en: 'M', ar: 'وسط' },
    { code: 'L', en: 'L', ar: 'كبير' },
    { code: 'XL', en: 'XL', ar: 'كبير جدًا' },
  ],
};

const SHOE_SIZES: SeedOption = {
  code: 'size',
  en: 'Size (EU)',
  ar: 'المقاس (أوروبي)',
  values: [
    { code: '39', en: '39', ar: '٣٩' },
    { code: '40', en: '40', ar: '٤٠' },
    { code: '41', en: '41', ar: '٤١' },
    { code: '42', en: '42', ar: '٤٢' },
    { code: '43', en: '43', ar: '٤٣' },
  ],
};

function colours(...values: SeedOptionValue[]): SeedOption {
  return { code: 'color', en: 'Colour', ar: 'اللون', values };
}

const BLACK = { code: 'black', en: 'Black', ar: 'أسود', swatch: '#111111' };
const WHITE = { code: 'white', en: 'White', ar: 'أبيض', swatch: '#f8fafc' };
const SAND = { code: 'sand', en: 'Sand', ar: 'رملي', swatch: '#d6c7a8' };
const NAVY = { code: 'navy', en: 'Navy', ar: 'كحلي', swatch: '#1e293b' };
const OLIVE = { code: 'olive', en: 'Olive', ar: 'زيتي', swatch: '#6b7a45' };
const SILVER = { code: 'silver', en: 'Silver', ar: 'فضي', swatch: '#cbd5e1' };
const TAN = { code: 'tan', en: 'Tan', ar: 'بني فاتح', swatch: '#b08050' };
const CORAL = { code: 'coral', en: 'Coral', ar: 'مرجاني', swatch: '#f08a6a' };
const EMERALD = { code: 'emerald', en: 'Emerald', ar: 'زمردي', swatch: '#0f766e' };

// ── Category tree ───────────────────────────────────────────────────────────

export const CATEGORY_TREE: SeedCategory[] = [
  {
    en: 'Men',
    ar: 'رجالي',
    image: 'photo-1441986300917-64674bd600d8',
    children: [
      { en: 'T-Shirts', ar: 'تي شيرت', image: 'photo-1521572163474-6864f9cf17ab' },
      { en: 'Shirts', ar: 'قمصان', image: 'photo-1523381210434-271e8be1f52b' },
      { en: 'Jackets', ar: 'جاكيتات', image: 'photo-1551028719-00167b16eac5' },
      { en: 'Trousers', ar: 'بناطيل', image: 'photo-1594633312681-425c7b97ccd1' },
      { en: "Men's Shoes", ar: 'أحذية رجالي', image: 'photo-1560343090-f0409e92791a' },
    ],
  },
  {
    en: 'Women',
    ar: 'حريمي',
    image: 'photo-1515372039744-b8f02a3ae446',
    children: [
      { en: 'Dresses', ar: 'فساتين', image: 'photo-1572804013309-59a88b7e92f1' },
      { en: 'Handbags', ar: 'حقائب يد', image: 'photo-1548036328-c9fa89d128fa' },
      { en: "Women's Shoes", ar: 'أحذية حريمي', image: 'photo-1595950653106-6c9ebd614d3a' },
    ],
  },
  {
    en: 'Electronics',
    ar: 'إلكترونيات',
    image: 'photo-1517336714731-489689fd1ca8',
    children: [
      { en: 'Headphones', ar: 'سماعات', image: 'photo-1505740420928-5e560c06d30e' },
      { en: 'Smart Watches', ar: 'ساعات ذكية', image: 'photo-1523275335684-37898b6baf30' },
      { en: 'Laptops & Tablets', ar: 'لابتوب وتابلت', image: 'photo-1496181133206-80ce9b88a853' },
      { en: 'Cameras', ar: 'كاميرات', image: 'photo-1516035069371-29a1b244cc32' },
    ],
  },
  {
    en: 'Home & Living',
    ar: 'المنزل والمعيشة',
    image: 'photo-1493663284031-b7e3aefcae8e',
    children: [
      { en: 'Furniture', ar: 'أثاث', image: 'photo-1555041469-a586c61ea9bc' },
      { en: 'Lighting', ar: 'إضاءة', image: 'photo-1540932239986-30128078f3c5' },
      { en: 'Kitchen', ar: 'المطبخ', image: 'photo-1602143407151-7111542de6e8' },
    ],
  },
  {
    en: 'Beauty',
    ar: 'الجمال والعناية',
    image: 'photo-1567721913486-6585f069b332',
    children: [
      { en: 'Fragrance', ar: 'عطور', image: 'photo-1585386959984-a4155224a1ad' },
      { en: 'Skincare', ar: 'العناية بالبشرة', image: 'photo-1611930022073-b7a4ba5fcccd' },
    ],
  },
  {
    en: 'Accessories',
    ar: 'إكسسوارات',
    image: 'photo-1473496169904-658ba7c44d8a',
    children: [
      { en: 'Sunglasses', ar: 'نظارات شمسية', image: 'photo-1572635196237-14b3f281503f' },
      { en: 'Watches', ar: 'ساعات', image: 'photo-1587836374828-4dbafa94cf0e' },
      { en: 'Jewellery', ar: 'مجوهرات', image: 'photo-1608042314453-ae338d80c427' },
      { en: 'Bags & Backpacks', ar: 'شنط وحقائب ظهر', image: 'photo-1553062407-98eeb64c6a62' },
    ],
  },
];

// ── Products ────────────────────────────────────────────────────────────────

export const SEED_PRODUCTS: SeedProduct[] = [
  // ── Men : T-Shirts ────────────────────────────────────────────────────────
  {
    en: 'Classic Cotton Tee',
    ar: 'تي شيرت قطن كلاسيك',
    brand: 'Sunshop',
    category: 'T-Shirts',
    price: 24_900,
    compareAt: 32_000,
    descEn:
      'A heavyweight 240gsm cotton tee cut for everyday wear. Pre-shrunk, colour-fast, and finished with a ribbed collar that keeps its shape after a hundred washes.',
    descAr:
      'تي شيرت قطن ثقيل ٢٤٠ جرام مناسب للاستخدام اليومي. مقاوم للانكماش وثابت اللون، وبياقة مضلعة تحافظ على شكلها بعد مئة غسلة.',
    images: ['photo-1521572163474-6864f9cf17ab', 'photo-1620799140408-edc6dcb6d633'],
    tags: ['cotton', 'basics', 'everyday'],
    options: [APPAREL_SIZES, colours(BLACK, WHITE, SAND)],
    featured: true,
    soldCount: 412,
    rating: 4.8,
  },
  {
    en: 'Original Graphic Tee',
    ar: 'تي شيرت أوريجينال مطبوع',
    brand: 'Sunshop',
    category: 'T-Shirts',
    price: 29_900,
    descEn:
      'Screen-printed by hand in small runs. The ink is water-based, so the print stays soft against the skin instead of sitting on top of the fabric.',
    descAr:
      'طباعة يدوية بكميات محدودة. الحبر مائي، فتظل الطباعة ناعمة على الجلد بدلًا من أن تكون طبقة فوق القماش.',
    images: ['photo-1576566588028-4147f3842f27'],
    tags: ['graphic', 'streetwear'],
    options: [APPAREL_SIZES],
    soldCount: 188,
    rating: 4.5,
  },
  {
    en: 'Heavyweight Crewneck Sweatshirt',
    ar: 'سويت شيرت ثقيل برقبة دائرية',
    brand: 'Sunshop',
    category: 'T-Shirts',
    price: 54_900,
    compareAt: 69_900,
    descEn:
      'Brushed fleece interior, 400gsm, with set-in sleeves that sit properly on the shoulder rather than dropping halfway down the arm.',
    descAr:
      'بطانة صوف ناعمة بوزن ٤٠٠ جرام، وأكمام مركبة تستقر على الكتف بشكل صحيح بدلًا من أن تنزل لمنتصف الذراع.',
    images: ['photo-1620799140408-edc6dcb6d633'],
    tags: ['fleece', 'winter'],
    options: [APPAREL_SIZES, colours(WHITE, BLACK, OLIVE)],
    soldCount: 233,
    rating: 4.7,
  },

  // ── Men : Shirts ──────────────────────────────────────────────────────────
  {
    en: 'Sage Linen Shirt',
    ar: 'قميص كتان بلون المريمية',
    brand: 'Nile Goods',
    category: 'Shirts',
    price: 79_900,
    compareAt: 95_000,
    descEn:
      'European flax linen, garment-washed so it arrives soft rather than stiff. Breathes well enough for an Egyptian August.',
    descAr:
      'كتان أوروبي مغسول مسبقًا فيصلك ناعمًا لا خشنًا. يسمح بمرور الهواء بما يكفي لأغسطس المصري.',
    images: ['photo-1523381210434-271e8be1f52b'],
    tags: ['linen', 'summer'],
    options: [APPAREL_SIZES, colours(OLIVE, WHITE)],
    featured: true,
    soldCount: 156,
    rating: 4.6,
  },
  {
    en: 'Weekend Layering Set',
    ar: 'طقم طبقات نهاية الأسبوع',
    brand: 'Sunshop',
    category: 'Shirts',
    price: 119_900,
    descEn:
      'A knit, a shirt and a beanie chosen to work together. Buying the three separately costs about a fifth more.',
    descAr: 'بلوفر وقميص وطاقية مختارة لتُلبس معًا. شراؤها منفردة يكلف نحو خُمس أعلى.',
    images: ['photo-1556905055-8f358a7a47b2'],
    tags: ['bundle', 'autumn'],
    options: [APPAREL_SIZES],
    soldCount: 74,
    rating: 4.4,
  },

  // ── Men : Jackets ─────────────────────────────────────────────────────────
  {
    en: 'Rider Leather Jacket',
    ar: 'جاكيت جلد رايدر',
    brand: 'Atlas',
    category: 'Jackets',
    price: 449_900,
    compareAt: 549_900,
    descEn:
      'Full-grain lambskin with an asymmetric zip and a quilted shoulder panel. Heavy at first, then it moulds to you.',
    descAr: 'جلد غنم كامل الحبيبات بسحاب مائل ولوح كتف مبطن. ثقيل في البداية ثم يأخذ شكل جسمك.',
    images: ['photo-1551028719-00167b16eac5'],
    tags: ['leather', 'outerwear'],
    options: [APPAREL_SIZES],
    featured: true,
    soldCount: 61,
    rating: 4.9,
  },
  {
    en: 'Coral Bomber Jacket',
    ar: 'جاكيت بومبر مرجاني',
    brand: 'Sunshop',
    category: 'Jackets',
    price: 189_900,
    compareAt: 229_900,
    descEn:
      'Water-repellent shell with a ribbed hem and two zip pockets deep enough for a phone that will not fall out.',
    descAr: 'قماش خارجي طارد للماء بحاشية مضلعة وجيبين بسحاب عميقين بما يكفي لهاتف لا يسقط.',
    images: ['photo-1591047139829-d91aecb6caea'],
    tags: ['bomber', 'spring'],
    options: [APPAREL_SIZES, colours(CORAL, BLACK)],
    soldCount: 97,
    rating: 4.3,
  },

  // ── Men : Trousers ────────────────────────────────────────────────────────
  {
    en: 'Relaxed Jogger Pants',
    ar: 'بنطلون جوجر واسع',
    brand: 'Sunshop',
    category: 'Trousers',
    price: 64_900,
    descEn:
      'Tapered through the leg with a proper drawcord waist, not the elastic-only kind that stretches out by week three.',
    descAr: 'ضيق تدريجيًا عند الساق مع رباط خصر حقيقي، وليس المطاط وحده الذي يتمدد بعد أسبوعين.',
    images: ['photo-1594633312681-425c7b97ccd1'],
    tags: ['loungewear', 'cotton'],
    options: [APPAREL_SIZES, colours(SAND, BLACK, NAVY)],
    soldCount: 205,
    rating: 4.4,
  },

  // ── Men : Shoes ───────────────────────────────────────────────────────────
  {
    en: 'Emerald Derby Shoes',
    ar: 'حذاء ديربي زمردي',
    brand: 'Atlas',
    category: "Men's Shoes",
    price: 289_900,
    compareAt: 349_900,
    descEn:
      'Goodyear-welted, which means the sole can be replaced instead of the whole shoe. Suede upper in a green that reads almost black indoors.',
    descAr:
      'مخيط بطريقة جوديير، أي يمكن استبدال النعل بدلًا من الحذاء كله. وجه من الشامواه بأخضر يبدو أسود تقريبًا في الداخل.',
    images: ['photo-1560343090-f0409e92791a'],
    tags: ['leather', 'formal'],
    options: [SHOE_SIZES],
    featured: true,
    soldCount: 88,
    rating: 4.7,
  },
  {
    en: 'Desert Court Sneakers',
    ar: 'حذاء ديزرت كورت الرياضي',
    brand: 'Vector',
    category: "Men's Shoes",
    price: 219_900,
    descEn:
      'Nubuck upper on a cupsole with a foam midsole. Built for walking a city all day, not for the gym.',
    descAr:
      'وجه من النوبوك على نعل كوب مع طبقة فوم. مصمم للمشي في المدينة طوال اليوم لا للصالة الرياضية.',
    images: ['photo-1549298916-b41d501d3772'],
    tags: ['sneakers', 'casual'],
    options: [SHOE_SIZES, colours(TAN, WHITE)],
    soldCount: 341,
    rating: 4.6,
  },
  {
    en: 'Court Leather Sneakers',
    ar: 'حذاء كورت جلد',
    brand: 'Vector',
    category: "Men's Shoes",
    price: 179_900,
    compareAt: 209_900,
    descEn:
      'A plain white leather sneaker with no visible branding beyond a heel tab. Wipes clean with a damp cloth.',
    descAr: 'حذاء جلد أبيض بسيط بلا علامات ظاهرة عدا لسان الكعب. ينظف بقطعة قماش مبللة.',
    images: ['photo-1608231387042-66d1773070a5'],
    tags: ['sneakers', 'minimal'],
    options: [SHOE_SIZES],
    soldCount: 278,
    rating: 4.5,
  },
  {
    en: 'Crimson Trail Runner',
    ar: 'حذاء جري كريمسون',
    brand: 'Vector',
    category: "Men's Shoes",
    price: 259_900,
    compareAt: 299_900,
    descEn:
      'Knit upper, 8mm drop, and a lug outsole that holds on wet stone. Weighs 244g in size 42.',
    descAr:
      'وجه محبوك بفارق ارتفاع ٨ مم ونعل خارجي يتماسك على الحجر المبلل. وزنه ٢٤٤ جرامًا في المقاس ٤٢.',
    images: ['photo-1542291026-7eec264c27ff'],
    tags: ['running', 'sport'],
    options: [SHOE_SIZES],
    soldCount: 402,
    rating: 4.8,
  },

  // ── Women : Dresses ───────────────────────────────────────────────────────
  {
    en: 'Portofino White Dress',
    ar: 'فستان بورتوفينو الأبيض',
    brand: 'Sunshop',
    category: 'Dresses',
    price: 149_900,
    compareAt: 189_900,
    descEn:
      'Off-shoulder cotton poplin with a tiered skirt. Lined to the knee, so it holds its shape in wind.',
    descAr: 'قطن بوبلين بأكتاف مكشوفة وتنورة متدرجة. مبطن حتى الركبة فيحافظ على شكله مع الهواء.',
    images: ['photo-1515372039744-b8f02a3ae446'],
    tags: ['summer', 'cotton'],
    options: [APPAREL_SIZES],
    featured: true,
    soldCount: 176,
    rating: 4.7,
  },
  {
    en: 'Scarlet Floral Midi Dress',
    ar: 'فستان ميدي أحمر مورّد',
    brand: 'Sunshop',
    category: 'Dresses',
    price: 129_900,
    descEn:
      'Viscose crepe with a wrap front and a self-tie waist that actually stays tied. Prints are cut to match at the seam.',
    descAr:
      'كريب فيسكوز بقصة ملفوفة ورباط خصر يبقى مربوطًا فعلًا. الطبعة مقصوصة لتتطابق عند الحياكة.',
    images: ['photo-1572804013309-59a88b7e92f1'],
    tags: ['floral', 'midi'],
    options: [APPAREL_SIZES],
    soldCount: 143,
    rating: 4.5,
  },
  {
    en: 'Crimson Evening Gown',
    ar: 'فستان سهرة كريمسون',
    brand: 'Atlas',
    category: 'Dresses',
    price: 399_900,
    compareAt: 479_900,
    descEn:
      'Twelve metres of chiffon in the skirt, with a boned bodice that needs no separate support.',
    descAr: 'اثنا عشر مترًا من الشيفون في التنورة، مع صدرية مدعمة لا تحتاج مشدًا منفصلًا.',
    images: ['photo-1595777457583-95e059d581b8'],
    tags: ['formal', 'occasion'],
    options: [APPAREL_SIZES],
    featured: true,
    soldCount: 39,
    rating: 4.9,
  },

  // ── Women : Handbags ──────────────────────────────────────────────────────
  {
    en: 'Quilted Chain Shoulder Bag',
    ar: 'شنطة كتف مبطنة بسلسلة',
    brand: 'Atlas',
    category: 'Handbags',
    price: 549_900,
    compareAt: 649_900,
    descEn:
      'Diamond-quilted lambskin with an antiqued brass chain. Fits a phone, a passport and a small wallet, and nothing more.',
    descAr:
      'جلد غنم مبطن بنقشة معينية وسلسلة نحاسية عتيقة. تتسع لهاتف وجواز سفر ومحفظة صغيرة، ولا شيء أكثر.',
    images: ['photo-1548036328-c9fa89d128fa'],
    tags: ['leather', 'luxury'],
    featured: true,
    soldCount: 52,
    rating: 4.8,
  },
  {
    en: 'Vermilion Leather Satchel',
    ar: 'شنطة ساتشل جلد قرمزية',
    brand: 'Nile Goods',
    category: 'Handbags',
    price: 329_900,
    descEn:
      'Structured calf leather with a turn-lock closure and a detachable strap. Holds a 13-inch laptop flat.',
    descAr: 'جلد عجل مشدود بإغلاق دوّار وحزام قابل للفصل. تتسع للابتوب ١٣ بوصة بشكل مستوٍ.',
    images: ['photo-1584917865442-de89df76afd3'],
    tags: ['leather', 'work'],
    soldCount: 91,
    rating: 4.6,
  },
  {
    en: 'Woven Tan Top-Handle Bag',
    ar: 'شنطة يد منسوجة بلون بني فاتح',
    brand: 'Nile Goods',
    category: 'Handbags',
    price: 289_900,
    compareAt: 340_000,
    descEn:
      'Hand-woven panels over a rigid frame, finished with a cotton-lined interior and a single interior pocket.',
    descAr: 'ألواح منسوجة يدويًا على هيكل صلب، ببطانة قطنية من الداخل وجيب داخلي واحد.',
    images: ['photo-1590874103328-eac38a683ce7'],
    tags: ['handmade', 'summer'],
    soldCount: 67,
    rating: 4.5,
  },

  // ── Women : Shoes ─────────────────────────────────────────────────────────
  {
    en: 'Pastel Court Sneakers',
    ar: 'حذاء كورت باستيل',
    brand: 'Vector',
    category: "Women's Shoes",
    price: 199_900,
    compareAt: 239_900,
    descEn:
      'Colour-blocked leather in four soft tones, on a slightly raised sole that adds height without looking like it is trying to.',
    descAr: 'جلد بألوان متدرجة ناعمة على نعل مرتفع قليلًا يضيف طولًا دون مبالغة.',
    images: ['photo-1595950653106-6c9ebd614d3a'],
    tags: ['sneakers', 'pastel'],
    options: [SHOE_SIZES],
    featured: true,
    soldCount: 224,
    rating: 4.7,
  },
  {
    en: 'Chunky Colour-Block Sneakers',
    ar: 'حذاء رياضي بنعل عريض متعدد الألوان',
    brand: 'Vector',
    category: "Women's Shoes",
    price: 249_900,
    descEn:
      'A 45mm stacked sole with a mesh and suede upper. Heavier than it looks, and considerably more comfortable.',
    descAr: 'نعل مركب بارتفاع ٤٥ مم مع وجه من الشبك والشامواه. أثقل مما يبدو وأكثر راحة بكثير.',
    images: ['photo-1560769629-975ec94e6a86'],
    tags: ['sneakers', 'statement'],
    options: [SHOE_SIZES],
    soldCount: 118,
    rating: 4.3,
  },

  // ── Electronics : Headphones ──────────────────────────────────────────────
  {
    en: 'Aurora Studio Headphones',
    ar: 'سماعات أورورا استوديو',
    brand: 'Aurora',
    category: 'Headphones',
    price: 349_900,
    compareAt: 429_900,
    descEn:
      'Active noise cancelling with a 40-hour battery and USB-C fast charge. Ten minutes on the cable gives about five hours of playback.',
    descAr:
      'إلغاء ضوضاء نشط مع بطارية ٤٠ ساعة وشحن سريع عبر USB-C. عشر دقائق شحن تعطي نحو خمس ساعات تشغيل.',
    images: ['photo-1505740420928-5e560c06d30e', 'photo-1498049794561-7780e7231661'],
    tags: ['audio', 'anc', 'wireless'],
    options: [colours(BLACK, SILVER)],
    featured: true,
    soldCount: 517,
    rating: 4.8,
  },
  {
    en: 'Aurora ANC Over-Ear',
    ar: 'سماعات أورورا فوق الأذن بإلغاء الضوضاء',
    brand: 'Aurora',
    category: 'Headphones',
    price: 279_900,
    descEn:
      'Memory-foam earcups that seal without clamping. Passive isolation alone cuts about 18dB before the electronics do anything.',
    descAr:
      'وسائد من الفوم تلتصق دون ضغط. العزل السلبي وحده يقلل نحو ١٨ ديسيبل قبل أن تعمل الإلكترونيات.',
    images: ['photo-1546435770-a3e426bf472b'],
    tags: ['audio', 'anc'],
    options: [colours(BLACK)],
    soldCount: 289,
    rating: 4.6,
  },
  {
    en: 'Copper Classic Headphones',
    ar: 'سماعات كوبر كلاسيك',
    brand: 'Aurora',
    category: 'Headphones',
    price: 189_900,
    compareAt: 229_900,
    descEn:
      'Wired, 32-ohm, with a copper-finished yoke and a replaceable 1.5m cable. No battery to die mid-flight.',
    descAr:
      'سلكية بمقاومة ٣٢ أوم وذراع بتشطيب نحاسي وكابل ١٫٥ متر قابل للاستبدال. لا بطارية تنفد في منتصف الرحلة.',
    images: ['photo-1484704849700-f032a568e944'],
    tags: ['audio', 'wired'],
    soldCount: 142,
    rating: 4.4,
  },
  {
    en: 'Monitor On-Ear Headphones',
    ar: 'سماعات مونيتور على الأذن',
    brand: 'Aurora',
    category: 'Headphones',
    price: 129_900,
    descEn:
      'A flat response tuned for editing rather than for impressing. Folds to about the size of a paperback.',
    descAr: 'استجابة صوتية مسطحة مضبوطة للمونتاج لا للإبهار. تُطوى إلى حجم كتاب صغير تقريبًا.',
    images: ['photo-1583394838336-acd977736f90'],
    tags: ['audio', 'studio'],
    soldCount: 96,
    rating: 4.2,
  },

  // ── Electronics : Smart Watches ───────────────────────────────────────────
  {
    en: 'Pulse Smart Watch 2',
    ar: 'ساعة بالس الذكية ٢',
    brand: 'Pulse',
    category: 'Smart Watches',
    price: 289_900,
    descEn:
      'AMOLED display, dual-band GPS, seven-day battery and 50m water resistance. Reads a heart rate every second, not every five minutes.',
    descAr:
      'شاشة AMOLED ونظام GPS مزدوج وبطارية سبعة أيام ومقاومة للماء حتى ٥٠ مترًا. تقرأ النبض كل ثانية لا كل خمس دقائق.',
    images: ['photo-1434493789847-2f02dc6ca35d', 'photo-1434493907317-a46b5bbe7834'],
    tags: ['wearable', 'fitness'],
    options: [
      {
        code: 'size',
        en: 'Case',
        ar: 'الحجم',
        values: [
          { code: '41mm', en: '41mm', ar: '٤١ مم' },
          { code: '45mm', en: '45mm', ar: '٤٥ مم' },
        ],
      },
    ],
    featured: true,
    soldCount: 463,
    rating: 4.7,
  },
  {
    en: 'Pulse Sport Band Watch',
    ar: 'ساعة بالس سبورت',
    brand: 'Pulse',
    category: 'Smart Watches',
    price: 219_900,
    compareAt: 259_900,
    descEn:
      'The same sensor stack in a lighter aluminium case, on a fluoroelastomer band that does not hold sweat.',
    descAr: 'نفس مجموعة الحساسات في هيكل ألمنيوم أخف، بسوار مطاطي لا يحتفظ بالعرق.',
    images: ['photo-1546868871-7041f2a55e12'],
    tags: ['wearable', 'sport'],
    soldCount: 312,
    rating: 4.5,
  },
  {
    en: 'Pulse Lite',
    ar: 'ساعة بالس لايت',
    brand: 'Pulse',
    category: 'Smart Watches',
    price: 149_900,
    descEn:
      'Notifications, steps and sleep, with a fourteen-day battery because it leaves out GPS. An honest trade.',
    descAr: 'إشعارات وخطوات ونوم، مع بطارية أربعة عشر يومًا لأنها بلا GPS. مقايضة صريحة.',
    images: ['photo-1523275335684-37898b6baf30'],
    tags: ['wearable', 'budget'],
    options: [colours(WHITE, BLACK)],
    soldCount: 388,
    rating: 4.3,
  },
  {
    en: 'Pulse Titanium',
    ar: 'ساعة بالس تيتانيوم',
    brand: 'Pulse',
    category: 'Smart Watches',
    price: 549_900,
    compareAt: 629_900,
    descEn:
      'Grade-5 titanium case with a sapphire crystal. Heavier by 4g than the aluminium model and considerably harder to scratch.',
    descAr:
      'هيكل تيتانيوم من الدرجة الخامسة بزجاج سافير. أثقل بأربعة جرامات من طراز الألمنيوم وأصعب بكثير في الخدش.',
    images: ['photo-1546868871-7041f2a55e12'],
    tags: ['wearable', 'premium'],
    soldCount: 74,
    rating: 4.9,
  },

  // ── Electronics : Laptops & Tablets ───────────────────────────────────────
  {
    en: 'Meridian Ultrabook 14',
    ar: 'لابتوب ميريديان الترابوك ١٤',
    brand: 'Meridian',
    category: 'Laptops & Tablets',
    price: 2_899_900,
    compareAt: 3_199_900,
    descEn:
      'A 14-inch 2.8K display, 16GB of memory and a fanless chassis. Silent under everything short of a compile.',
    descAr:
      'شاشة ١٤ بوصة بدقة ٢٫٨K وذاكرة ١٦ جيجابايت وهيكل بلا مروحة. صامت في كل شيء عدا عمليات البناء الثقيلة.',
    images: ['photo-1496181133206-80ce9b88a853'],
    tags: ['laptop', 'portable'],
    options: [
      {
        code: 'storage',
        en: 'Storage',
        ar: 'السعة',
        values: [
          { code: '512gb', en: '512 GB', ar: '٥١٢ جيجا' },
          { code: '1tb', en: '1 TB', ar: '١ تيرا' },
        ],
      },
    ],
    featured: true,
    soldCount: 87,
    rating: 4.7,
  },
  {
    en: 'Meridian Pro 16',
    ar: 'لابتوب ميريديان برو ١٦',
    brand: 'Meridian',
    category: 'Laptops & Tablets',
    price: 4_599_900,
    descEn:
      'Sixteen inches, 32GB, and a display calibrated at the factory to Delta-E under 2. For work where colour has to be right.',
    descAr:
      'ست عشرة بوصة و٣٢ جيجابايت وشاشة معايرة من المصنع بفارق لوني أقل من ٢. لعمل يجب أن تكون فيه الألوان صحيحة.',
    images: ['photo-1517336714731-489689fd1ca8'],
    tags: ['laptop', 'creative'],
    soldCount: 41,
    rating: 4.8,
  },
  {
    en: 'Meridian Air',
    ar: 'لابتوب ميريديان إير',
    brand: 'Meridian',
    category: 'Laptops & Tablets',
    price: 1_899_900,
    compareAt: 2_199_900,
    descEn:
      'Under a kilogram with an eighteen-hour battery. The keyboard travel is shallow, which is the price of the thickness.',
    descAr: 'أقل من كيلوجرام ببطارية ثمانية عشرة ساعة. مسافة ضغط الكيبورد قصيرة، وهذا ثمن النحافة.',
    images: ['photo-1531297484001-80022131f5a1'],
    tags: ['laptop', 'lightweight'],
    soldCount: 129,
    rating: 4.4,
  },
  {
    en: 'Meridian Tab 11',
    ar: 'تابلت ميريديان ١١',
    brand: 'Meridian',
    category: 'Laptops & Tablets',
    price: 1_199_900,
    descEn:
      'An 11-inch 120Hz panel with pen support. Charges over USB-C from the same brick as the laptops.',
    descAr: 'شاشة ١١ بوصة بتردد ١٢٠ هرتز مع دعم القلم. تُشحن عبر USB-C من نفس شاحن اللابتوبات.',
    images: ['photo-1544244015-0df4b3ffc6b0'],
    tags: ['tablet', 'stylus'],
    soldCount: 203,
    rating: 4.5,
  },

  // ── Electronics : Cameras ─────────────────────────────────────────────────
  {
    en: 'Aperture Mirrorless Camera',
    ar: 'كاميرا أبيرتشر بدون مرآة',
    brand: 'Aperture',
    category: 'Cameras',
    price: 3_899_900,
    compareAt: 4_299_900,
    descEn:
      'A 33MP full-frame sensor with in-body stabilisation rated at seven stops. Body only; the lens in the photo is sold separately.',
    descAr:
      'حساس كامل الإطار بدقة ٣٣ ميجابكسل مع تثبيت داخلي بمقدار سبع درجات. الهيكل فقط، والعدسة في الصورة تُباع منفصلة.',
    images: ['photo-1516035069371-29a1b244cc32'],
    tags: ['camera', 'fullframe'],
    featured: true,
    soldCount: 34,
    rating: 4.9,
  },
  {
    en: 'Instant Print Camera',
    ar: 'كاميرا طباعة فورية',
    brand: 'Aperture',
    category: 'Cameras',
    price: 449_900,
    descEn:
      'Prints a square photo in about fifteen minutes of development. Film is sold in packs of eight.',
    descAr: 'تطبع صورة مربعة تظهر خلال نحو خمس عشرة دقيقة. الفيلم يُباع في علب من ثماني صور.',
    images: ['photo-1526170375885-4d8ecf77b99f'],
    tags: ['camera', 'instant', 'gift'],
    soldCount: 167,
    rating: 4.4,
  },

  // ── Home & Living : Furniture ─────────────────────────────────────────────
  {
    en: 'Emerald Velvet Sofa',
    ar: 'كنبة مخمل زمردية',
    brand: 'Atlas',
    category: 'Furniture',
    price: 4_299_900,
    compareAt: 4_999_900,
    descEn:
      'Three seats on a solid beech frame with sinuous spring suspension. Delivered assembled; the legs screw on in a minute.',
    descAr: 'ثلاثة مقاعد على هيكل زان صلب مع تعليق زنبركي. تُسلَّم مجمعة، والأرجل تُركب في دقيقة.',
    images: ['photo-1555041469-a586c61ea9bc'],
    tags: ['sofa', 'velvet'],
    options: [colours(EMERALD, NAVY)],
    featured: true,
    soldCount: 23,
    rating: 4.8,
  },
  {
    en: 'Cream Tufted Armchair',
    ar: 'كرسي بذراعين كريمي منجّد',
    brand: 'Atlas',
    category: 'Furniture',
    price: 1_599_900,
    descEn:
      'Hand-tufted back on a turned wooden frame. The fabric is treated, so a spilled coffee beads rather than soaks.',
    descAr:
      'ظهر منجّد يدويًا على هيكل خشبي مخروط. القماش معالج، فالقهوة المسكوبة تتجمع كقطرات ولا تتشرب.',
    images: ['photo-1567538096630-e0c55bd6374c'],
    tags: ['chair', 'classic'],
    soldCount: 47,
    rating: 4.6,
  },
  {
    en: 'Nordic Lounge Set',
    ar: 'طقم جلوس نورديك',
    brand: 'Atlas',
    category: 'Furniture',
    price: 5_899_900,
    compareAt: 6_799_900,
    descEn:
      'A sofa, two side tables and a rug chosen as one set. Sold together because the proportions were designed together.',
    descAr: 'كنبة وطاولتان جانبيتان وسجادة مختارة كطقم واحد. تُباع معًا لأن أبعادها صُممت معًا.',
    images: ['photo-1550581190-9c1c48d21d6c'],
    tags: ['set', 'living-room'],
    soldCount: 12,
    rating: 4.7,
  },
  {
    en: 'Studio Console Table',
    ar: 'طاولة كونسول ستوديو',
    brand: 'Nile Goods',
    category: 'Furniture',
    price: 899_900,
    descEn:
      'Solid oak, 120cm wide, with two drawers on soft-close runners. Deep enough for a router and its cables.',
    descAr: 'خشب بلوط صلب بعرض ١٢٠ سم ودرجان بمجاري إغلاق ناعم. عميقة بما يكفي لراوتر وأسلاكه.',
    images: ['photo-1513694203232-719a280e022f'],
    tags: ['oak', 'storage'],
    soldCount: 58,
    rating: 4.5,
  },

  // ── Home & Living : Lighting ──────────────────────────────────────────────
  {
    en: 'Brass Pendant Light',
    ar: 'نجفة معلقة نحاسية',
    brand: 'Nile Goods',
    category: 'Lighting',
    price: 349_900,
    compareAt: 419_900,
    descEn: 'Spun brass shade with a 2m braided cable. Takes an E27 bulb, dimmable if the bulb is.',
    descAr:
      'غطاء نحاسي مشكّل بكابل مجدول بطول مترين. تأخذ لمبة E27 وتقبل الخفت إذا كانت اللمبة تدعمه.',
    images: ['photo-1540932239986-30128078f3c5'],
    tags: ['brass', 'pendant'],
    featured: true,
    soldCount: 134,
    rating: 4.6,
  },

  // ── Home & Living : Kitchen ───────────────────────────────────────────────
  {
    en: 'Insulated Steel Bottle',
    ar: 'زجاجة ستيل معزولة',
    brand: 'Sunshop',
    category: 'Kitchen',
    price: 79_900,
    descEn:
      'Double-walled 18/8 steel, 750ml. Holds ice for about eighteen hours in a car in July, which is the test that matters here.',
    descAr:
      'ستيل ١٨/٨ بجدار مزدوج وسعة ٧٥٠ مل. تحفظ الثلج نحو ثماني عشرة ساعة داخل سيارة في يوليو، وهذا هو الاختبار المهم هنا.',
    images: ['photo-1602143407151-7111542de6e8'],
    tags: ['bottle', 'steel'],
    options: [colours(EMERALD, BLACK, WHITE)],
    soldCount: 421,
    rating: 4.7,
  },

  // ── Beauty : Fragrance ────────────────────────────────────────────────────
  {
    en: 'Noir Eau de Parfum',
    ar: 'عطر نوار أو دو بارفان',
    brand: 'Maison Nil',
    category: 'Fragrance',
    price: 429_900,
    compareAt: 499_900,
    descEn:
      'Bergamot over jasmine and vetiver, at 18% concentration. Six to eight hours on skin, longer on fabric.',
    descAr:
      'برغموت فوق الياسمين والفيتيفر بتركيز ١٨٪. يدوم من ست إلى ثماني ساعات على الجلد، وأطول على القماش.',
    images: ['photo-1585386959984-a4155224a1ad'],
    tags: ['fragrance', 'unisex'],
    featured: true,
    soldCount: 198,
    rating: 4.8,
  },
  {
    en: 'Rose Absolue Parfum',
    ar: 'عطر روز أبسولو',
    brand: 'Maison Nil',
    category: 'Fragrance',
    price: 519_900,
    descEn: 'Built on Taif rose absolute, which is why it costs what it does. Warm, not powdery.',
    descAr: 'مبني على خلاصة الورد الطائفي، ولهذا سعره كذلك. دافئ لا بودري.',
    images: ['photo-1592945403244-b3fbafd7f539'],
    tags: ['fragrance', 'rose'],
    soldCount: 112,
    rating: 4.9,
  },

  // ── Beauty : Skincare ─────────────────────────────────────────────────────
  {
    en: 'Ritual Skincare Set',
    ar: 'طقم العناية اليومية',
    brand: 'Maison Nil',
    category: 'Skincare',
    price: 259_900,
    compareAt: 319_900,
    descEn:
      'Cleanser, serum and moisturiser sized to last about three months together. Fragrance-free throughout.',
    descAr: 'غسول وسيروم ومرطب بأحجام تكفي نحو ثلاثة أشهر معًا. خالٍ من العطور بالكامل.',
    images: ['photo-1567721913486-6585f069b332'],
    tags: ['skincare', 'set'],
    featured: true,
    soldCount: 276,
    rating: 4.6,
  },
  {
    en: 'Hemp Seed Face Oil',
    ar: 'زيت بذور القنب للوجه',
    brand: 'Maison Nil',
    category: 'Skincare',
    price: 139_900,
    descEn:
      'Cold-pressed, single ingredient, in amber glass because the oil oxidises in clear bottles.',
    descAr: 'معصور على البارد بمكوّن واحد في زجاج كهرماني، لأن الزيت يتأكسد في الزجاجات الشفافة.',
    images: ['photo-1611930022073-b7a4ba5fcccd'],
    tags: ['skincare', 'natural'],
    soldCount: 154,
    rating: 4.5,
  },

  // ── Accessories : Sunglasses ──────────────────────────────────────────────
  {
    en: 'Dune Aviator Sunglasses',
    ar: 'نظارة ديون أفياتور',
    brand: 'Solstice',
    category: 'Sunglasses',
    price: 189_900,
    compareAt: 229_900,
    descEn:
      'Polarised CR-39 lenses in a titanium frame weighing 21g. Category 3 tint, so not for night driving.',
    descAr:
      'عدسات CR-39 مستقطبة في إطار تيتانيوم بوزن ٢١ جرامًا. تظليل من الفئة الثالثة، فليست للقيادة الليلية.',
    images: ['photo-1473496169904-658ba7c44d8a'],
    tags: ['sunglasses', 'polarised'],
    featured: true,
    soldCount: 231,
    rating: 4.7,
  },
  {
    en: 'Round Gold Sunglasses',
    ar: 'نظارة شمسية دائرية ذهبية',
    brand: 'Solstice',
    category: 'Sunglasses',
    price: 149_900,
    descEn:
      'Thin gold-tone wire with green glass lenses. Glass, not resin, so they scratch far less and weigh a little more.',
    descAr:
      'سلك رفيع بلون ذهبي مع عدسات زجاجية خضراء. زجاج لا راتنج، فتُخدش أقل بكثير وتزن أكثر قليلًا.',
    images: ['photo-1511499767150-a48a237f0083'],
    tags: ['sunglasses', 'retro'],
    soldCount: 143,
    rating: 4.4,
  },
  {
    en: 'Classic Black Sunglasses',
    ar: 'نظارة شمسية سوداء كلاسيك',
    brand: 'Solstice',
    category: 'Sunglasses',
    price: 129_900,
    descEn: 'Acetate frame in the shape that has been in production since 1952, with UV400 lenses.',
    descAr: 'إطار أسيتات بالشكل المستمر إنتاجه منذ ١٩٥٢، بعدسات بحماية UV400.',
    images: ['photo-1572635196237-14b3f281503f'],
    tags: ['sunglasses', 'classic'],
    soldCount: 305,
    rating: 4.6,
  },

  // ── Accessories : Watches ─────────────────────────────────────────────────
  {
    en: 'Minimal Field Watch',
    ar: 'ساعة فيلد بتصميم بسيط',
    brand: 'Meridian',
    category: 'Watches',
    price: 219_900,
    compareAt: 259_900,
    descEn:
      'A 38mm steel case on a leather strap, with a Swiss quartz movement rated to within 10 seconds a month.',
    descAr: 'هيكل ستيل ٣٨ مم بسوار جلد وحركة كوارتز سويسرية بدقة عشر ثوانٍ شهريًا.',
    images: ['photo-1524592094714-0f0654e20314'],
    tags: ['watch', 'minimal'],
    featured: true,
    soldCount: 187,
    rating: 4.7,
  },
  {
    en: 'Bronze Automatic Watch',
    ar: 'ساعة أوتوماتيك برونزية',
    brand: 'Meridian',
    category: 'Watches',
    price: 649_900,
    descEn:
      'Automatic movement with a 42-hour reserve in a bronze case that will patina unevenly, which is the point.',
    descAr:
      'حركة أوتوماتيكية باحتياطي ٤٢ ساعة في هيكل برونزي ستتغير طبقته بمرور الوقت، وهذا هو المقصود.',
    images: ['photo-1547996160-81dfa63595aa'],
    tags: ['watch', 'automatic'],
    soldCount: 58,
    rating: 4.8,
  },
  {
    en: 'Steel Chronograph Watch',
    ar: 'ساعة كرونوغراف ستيل',
    brand: 'Meridian',
    category: 'Watches',
    price: 879_900,
    compareAt: 999_900,
    descEn:
      'Three registers, a tachymeter bezel and 100m of water resistance. The bracelet has half-links for a proper fit.',
    descAr:
      'ثلاثة عدادات وإطار تاكيمتر ومقاومة للماء حتى ١٠٠ متر. السوار بوصلات نصفية لضبط المقاس بدقة.',
    images: ['photo-1587836374828-4dbafa94cf0e'],
    tags: ['watch', 'chronograph'],
    featured: true,
    soldCount: 44,
    rating: 4.9,
  },

  // ── Accessories : Jewellery ───────────────────────────────────────────────
  {
    en: 'Stone Ring Set',
    ar: 'طقم خواتم بأحجار',
    brand: 'Maison Nil',
    category: 'Jewellery',
    price: 189_900,
    descEn:
      'Three stacking rings in gold vermeil with turquoise and carnelian cabochons. Sold as a set, wearable apart.',
    descAr:
      'ثلاثة خواتم متراكبة من الفضة المطلية بالذهب مع أحجار فيروز وعقيق. تُباع كطقم وتُلبس منفردة.',
    images: ['photo-1608042314453-ae338d80c427'],
    tags: ['jewellery', 'rings'],
    soldCount: 96,
    rating: 4.5,
  },

  // ── Accessories : Bags & Backpacks ────────────────────────────────────────
  {
    en: 'Commuter Backpack',
    ar: 'شنطة ظهر للتنقل اليومي',
    brand: 'Vector',
    category: 'Bags & Backpacks',
    price: 169_900,
    compareAt: 199_900,
    descEn:
      'A 22-litre roll-top in coated nylon with a padded 16-inch laptop sleeve that does not touch the bottom of the bag.',
    descAr:
      'شنطة ٢٢ لترًا بفتحة علوية ملفوفة من النايلون المطلي، بجيب مبطن للابتوب ١٦ بوصة لا يلامس قاع الشنطة.',
    images: ['photo-1553062407-98eeb64c6a62'],
    tags: ['backpack', 'commute'],
    options: [colours(NAVY, BLACK)],
    featured: true,
    soldCount: 268,
    rating: 4.6,
  },
];

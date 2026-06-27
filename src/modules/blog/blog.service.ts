/**
 * Blog content service. Public reads serve only PUBLISHED posts (for the SEO
 * blog pages); admin functions create/update/delete and write an audit record.
 * Cover images go through the shared storage provider (webp) like every other
 * image, so the same /images URL pipeline serves them.
 */
import { Types } from 'mongoose';
import { BlogPost, IBlogPost, BlogStatus } from '../../models/BlogPost';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { sanitizeRichHtml, deriveExcerpt } from '../../utils/sanitizeHtml';

const PAGE_SIZE = 9;

/** URL-friendly slug; keeps Persian + latin letters and digits, spaces → «-». */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[‌\s_]+/g, '-') // ZWNJ + whitespace + underscore → hyphen
    .replace(/[^؀-ۿa-z0-9-]/g, '') // keep Persian, latin, digits, hyphen
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function audit(adminId: string, action: string, targetId: string, summary?: Record<string, unknown>) {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(adminId),
      action,
      targetType: 'blog',
      targetId,
      summary: summary ?? null,
    });
  } catch {
    /* auditing must never break the action */
  }
}

/** Ensure the slug is unique, appending -2, -3, … on collision (ignoring `exceptId`). */
async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || 'post';
  let candidate = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await BlogPost.findOne({ slug: candidate, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
      .select('_id')
      .lean();
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

/**
 * Resolve a stored cover KEY to a public URL. Idempotent: a value that is
 * already an absolute URL (legacy/bad data) is returned untouched instead of
 * being prefixed again — this is what caused the «…/images/…/images/…» tripling.
 */
function coverUrl(key: string | null): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return storageProvider.getUrl(key);
}

/**
 * Coerce whatever the client sent for the cover back to a storage KEY. The
 * admin form used to submit the resolved URL; recover the key from any
 * «…/images/<key>» URL so create/update store the key (not a URL).
 */
function normalizeCoverKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const tail = value.split('/images/').pop() ?? value;
    try {
      return decodeURIComponent(tail);
    } catch {
      return tail;
    }
  }
  return value;
}

/** Excerpt to show: the explicit one, else a snippet derived from the body. */
function effectiveExcerpt(p: IBlogPost): string {
  return p.excerpt?.trim() ? p.excerpt : deriveExcerpt(p.content);
}

/** Public list card shape. */
function toCard(p: IBlogPost) {
  return {
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    excerpt: effectiveExcerpt(p),
    coverImage: coverUrl(p.coverImage),
    publishedAt: p.publishedAt,
  };
}

/** Public, full post shape (coverImage = display URL). */
function toFull(p: IBlogPost) {
  return {
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    excerpt: effectiveExcerpt(p),
    content: p.content,
    coverImage: coverUrl(p.coverImage),
    metaTitle: p.metaTitle ?? '',
    metaDescription: p.metaDescription ?? '',
    status: p.status,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Admin shape — like `toFull` but also exposes the raw `coverImageKey` so the
 * edit form can re-submit the KEY (not the URL), and the RAW `excerpt` (not the
 * derived one) so the field round-trips faithfully.
 */
function toAdmin(p: IBlogPost) {
  return {
    ...toFull(p),
    excerpt: p.excerpt ?? '',
    coverImageKey: p.coverImage ?? null,
  };
}

// ─────────────────────────────── Public ───────────────────────────────
export async function listPublished(page = 1) {
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const [items, total] = await Promise.all([
    BlogPost.find({ status: 'published' }).sort({ publishedAt: -1 }).skip(skip).limit(PAGE_SIZE),
    BlogPost.countDocuments({ status: 'published' }),
  ]);
  return { items: items.map(toCard), page: p, limit: PAGE_SIZE, total };
}

export async function getPublishedBySlug(slug: string) {
  const post = await BlogPost.findOne({ slug, status: 'published' });
  if (!post) throw AppError.notFound('نوشته یافت نشد', 'BLOG_NOT_FOUND');
  return toFull(post);
}

// ──────────────────────────────── Admin ───────────────────────────────
export async function adminList(page = 1) {
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const [items, total] = await Promise.all([
    BlogPost.find().sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE),
    BlogPost.countDocuments(),
  ]);
  return { items: items.map(toAdmin), page: p, limit: PAGE_SIZE, total };
}

export async function adminGet(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await BlogPost.findById(id);
  if (!post) throw AppError.notFound('نوشته یافت نشد', 'BLOG_NOT_FOUND');
  return toAdmin(post);
}

export interface BlogInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  coverImage?: string | null;
  metaTitle?: string;
  metaDescription?: string;
  status?: BlogStatus;
}

export async function create(adminId: string, data: BlogInput) {
  const slug = await uniqueSlug(data.slug || data.title);
  const status = data.status ?? 'draft';
  const post = await BlogPost.create({
    title: data.title,
    slug,
    excerpt: data.excerpt ?? '',
    content: sanitizeRichHtml(data.content ?? ''),
    coverImage: normalizeCoverKey(data.coverImage),
    metaTitle: data.metaTitle ?? '',
    metaDescription: data.metaDescription ?? '',
    status,
    author: new Types.ObjectId(adminId),
    publishedAt: status === 'published' ? new Date() : null,
  });
  await audit(adminId, 'blog.create', String(post._id), { title: post.title, slug, status });
  return toAdmin(post);
}

export async function update(adminId: string, id: string, data: BlogInput) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await BlogPost.findById(id);
  if (!post) throw AppError.notFound('نوشته یافت نشد', 'BLOG_NOT_FOUND');

  if (data.title !== undefined) post.title = data.title;
  if (data.excerpt !== undefined) post.excerpt = data.excerpt;
  if (data.content !== undefined) post.content = sanitizeRichHtml(data.content);
  if (data.metaTitle !== undefined) post.metaTitle = data.metaTitle;
  if (data.metaDescription !== undefined) post.metaDescription = data.metaDescription;
  if (data.slug !== undefined && data.slug.trim()) post.slug = await uniqueSlug(data.slug, id);
  if (data.coverImage !== undefined) {
    const nextKey = normalizeCoverKey(data.coverImage);
    // Replacing/removing the cover → best-effort delete of the old image.
    if (post.coverImage && post.coverImage !== nextKey) {
      await storageProvider.delete(post.coverImage).catch(() => undefined);
    }
    post.coverImage = nextKey;
  }
  if (data.status !== undefined && data.status !== post.status) {
    post.status = data.status;
    // Stamp publishedAt the first time it goes live.
    if (data.status === 'published' && !post.publishedAt) post.publishedAt = new Date();
  }

  await post.save();
  await audit(adminId, 'blog.update', id, { fields: Object.keys(data) });
  return toAdmin(post);
}

export async function remove(adminId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await BlogPost.findById(id);
  if (!post) throw AppError.notFound('نوشته یافت نشد', 'BLOG_NOT_FOUND');
  if (post.coverImage) await storageProvider.delete(post.coverImage).catch(() => undefined);
  await post.deleteOne();
  await audit(adminId, 'blog.delete', id, { title: post.title, slug: post.slug });
  return { id };
}

/** Save an uploaded cover image and return its key + public URL. */
export async function saveCover(adminId: string, file?: Express.Multer.File) {
  if (!file) throw AppError.badRequest('تصویری ارسال نشده است', 'NO_FILE');
  const stored = await storageProvider.save(file, { ownerType: 'blog', ownerId: adminId, kind: 'blog' });
  return { key: stored.path, url: storageProvider.getUrl(stored.path) };
}

/**
 * Internal social network (phase 1: photo posts, feed, comments, likes,
 * hashtags) + content-safety primitives (rules acceptance, profanity gate,
 * abuse reports, admin removal, social ban). Only GOLD-plan stylists may post;
 * anyone signed-in may comment/like/report; the feed is public.
 *
 * Built for extension: `Post.type` exists so video/story/before-after slot in
 * later without a migration.
 */
import { Types } from 'mongoose';
import { Post, IPost, PostType } from '../../models/Post';
import { PostComment } from '../../models/PostComment';
import { PostLike } from '../../models/PostLike';
import { SavedPost } from '../../models/SavedPost';
import { ContentReport, ReportTargetType } from '../../models/ContentReport';
import { Story } from '../../models/Story';
import { User } from '../../models/User';
import { StylistProfile } from '../../models/StylistProfile';
import { StylistService } from '../../models/StylistService';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { containsBannedWord } from '../../config/bannedWords';
import { getBookabilityMap } from '../stylist/bookability';

/** Multer field-style files: normal posts use `images`; before/after use both. */
export interface PostFiles {
  images?: Express.Multer.File[];
  before?: Express.Multer.File[];
  after?: Express.Multer.File[];
}

const PAGE_SIZE = 12;
const MAX_IMAGES = 8;

/** Extract `#tag` tokens (Persian + latin + digits + _), normalized lowercase. */
export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const tags = matches.map((m) => m.slice(1).toLowerCase());
  return [...new Set(tags)].slice(0, 30);
}

function imageUrls(keys: string[]): string[] {
  return keys.map((k) => storageProvider.getUrl(k));
}

// ───────────────────────────── serialization ─────────────────────────────
interface AuthorView {
  id: string;
  fullName: string;
  profilePhoto: string | null;
  isVerified: boolean;
}

function authorView(
  user: { _id: unknown; firstName?: string | null; lastName?: string | null; profilePhoto?: string | null } | null,
  verified: boolean,
): AuthorView {
  return {
    id: user ? String(user._id) : '',
    fullName: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'متخصص' : 'حذف‌شده',
    profilePhoto: user?.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
    isVerified: verified,
  };
}

interface PostFlags {
  likedByMe: boolean;
  savedByMe: boolean;
  bookable: boolean;
}

function postView(p: IPost, author: AuthorView, flags: PostFlags) {
  return {
    id: String(p._id),
    type: p.type,
    author,
    caption: p.caption,
    images: imageUrls(p.images),
    beforeImage: p.beforeImage ? storageProvider.getUrl(p.beforeImage) : null,
    afterImage: p.afterImage ? storageProvider.getUrl(p.afterImage) : null,
    relatedServiceId: p.relatedServiceId ? String(p.relatedServiceId) : null,
    hashtags: p.hashtags,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: flags.likedByMe,
    savedByMe: flags.savedByMe,
    // Booking shortcut: the post's stylist + whether they currently accept bookings.
    stylistId: String(p.authorId),
    bookable: flags.bookable,
    createdAt: p.createdAt,
  };
}

/**
 * Bulk-load authors (+ verified flag + bookability) and the viewer's likes/saves
 * for a set of posts. A few queries regardless of post count.
 */
async function hydratePosts(posts: IPost[], viewerId?: string) {
  if (posts.length === 0) return [];
  const authorIds = [...new Set(posts.map((p) => String(p.authorId)))];
  const postIds = posts.map((p) => p._id);
  const [users, profiles, likes, saves] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: authorIds } })
      .select('userId isVerified workplaceType freelance isAcceptingReservations')
      .lean(),
    viewerId
      ? PostLike.find({ postId: { $in: postIds }, userId: viewerId }).select('postId').lean()
      : Promise.resolve([]),
    viewerId
      ? SavedPost.find({ postId: { $in: postIds }, userId: viewerId }).select('postId').lean()
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const verifiedBy = new Map(profiles.map((pr) => [String(pr.userId), pr.isVerified === true]));
  const likedSet = new Set(likes.map((l) => String(l.postId)));
  const savedSet = new Set(saves.map((s) => String(s.postId)));
  // Bookability per author (active workplace + accepting) — drives the post's رزرو button.
  const bookMap = await getBookabilityMap(profiles as unknown as { userId: unknown }[]);
  return posts.map((p) => {
    const uid = String(p.authorId);
    return postView(p, authorView(userById.get(uid) ?? null, verifiedBy.get(uid) ?? false), {
      likedByMe: likedSet.has(String(p._id)),
      savedByMe: savedSet.has(String(p._id)),
      bookable: bookMap.get(uid)?.bookable ?? false,
    });
  });
}

// ───────────────────────────── access / gating ───────────────────────────
/** Whether this user can CREATE posts (gold-plan stylist, not banned). */
export async function getSocialAccess(userId?: string) {
  if (!userId) return { authenticated: false, canPost: false, planTier: 'free' as const, banned: false };
  const [user, profile] = await Promise.all([
    User.findById(userId).select('socialBanned roles').lean(),
    StylistProfile.findOne({ userId }).select('planTier').lean(),
  ]);
  const banned = user?.socialBanned === true;
  const planTier = (profile?.planTier ?? 'free') as 'free' | 'silver' | 'gold';
  const isStylist = (user?.roles ?? []).includes('stylist');
  return { authenticated: true, canPost: isStylist && planTier === 'gold' && !banned, planTier, banned };
}

async function assertNotBanned(userId: string) {
  const user = await User.findById(userId).select('socialBanned').lean();
  if (user?.socialBanned) {
    throw AppError.forbidden('حساب شما از شبکه‌ی اجتماعی مسدود شده است', 'SOCIAL_BANNED');
  }
}

// ───────────────────────────────── posts ─────────────────────────────────
export async function createPost(
  authorId: string,
  input: { caption: string; acceptedRules: boolean; type?: string; relatedServiceId?: string | null },
  files: PostFiles,
) {
  if (!input.acceptedRules) {
    throw AppError.badRequest('برای انتشار باید قوانین را بپذیرید', 'RULES_NOT_ACCEPTED');
  }
  // Gold-plan stylist only.
  const access = await getSocialAccess(authorId);
  if (access.banned) throw AppError.forbidden('حساب شما از شبکه‌ی اجتماعی مسدود شده است', 'SOCIAL_BANNED');
  if (!access.canPost) {
    throw AppError.forbidden('انتشار پست فقط برای پلن طلایی فعال است', 'SOCIAL_NOT_GOLD');
  }

  const caption = (input.caption ?? '').trim();
  if (containsBannedWord(caption)) {
    throw AppError.badRequest('متن شامل کلمه‌ی نامناسب است', 'PROFANITY');
  }

  const type: PostType = input.type === 'before_after' ? 'before_after' : 'normal';

  // Optional related service must be one the stylist actually offers.
  let relatedServiceId: Types.ObjectId | null = null;
  if (input.relatedServiceId) {
    if (!Types.ObjectId.isValid(input.relatedServiceId)) {
      throw AppError.badRequest('خدمت نامعتبر است', 'INVALID_SERVICE');
    }
    const offered = await StylistService.exists({ stylistId: authorId, serviceId: input.relatedServiceId });
    if (!offered) throw AppError.badRequest('این خدمت برای شما ثبت نشده است', 'SERVICE_NOT_OFFERED');
    relatedServiceId = new Types.ObjectId(input.relatedServiceId);
  }

  const save = (f: Express.Multer.File) =>
    storageProvider.save(f, { ownerType: 'post', ownerId: authorId, kind: 'social' });

  let images: string[] = [];
  let beforeImage: string | null = null;
  let afterImage: string | null = null;

  if (type === 'before_after') {
    const before = files.before?.[0];
    const after = files.after?.[0];
    if (!before || !after) {
      throw AppError.badRequest('برای پست قبل/بعد هر دو تصویر لازم است', 'BEFORE_AFTER_REQUIRED');
    }
    const [b, a] = await Promise.all([save(before), save(after)]);
    beforeImage = b.path;
    afterImage = a.path;
  } else {
    const imgs = files.images ?? [];
    if (imgs.length === 0) throw AppError.badRequest('حداقل یک عکس لازم است', 'NO_IMAGES');
    if (imgs.length > MAX_IMAGES) throw AppError.badRequest(`حداکثر ${MAX_IMAGES} عکس مجاز است`, 'TOO_MANY_IMAGES');
    const stored = await Promise.all(imgs.map(save));
    images = stored.map((s) => s.path);
  }

  const post = await Post.create({
    authorId: new Types.ObjectId(authorId),
    type,
    caption,
    images,
    beforeImage,
    afterImage,
    relatedServiceId,
    hashtags: extractHashtags(caption),
  });
  const [hydrated] = await hydratePosts([post], authorId);
  return hydrated;
}

export async function getFeed(page: number, viewerId?: string) {
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const [posts, total] = await Promise.all([
    Post.find({ status: 'active' }).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE),
    Post.countDocuments({ status: 'active' }),
  ]);
  return { items: await hydratePosts(posts, viewerId), page: p, limit: PAGE_SIZE, total };
}

export async function getPostById(id: string, viewerId?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await Post.findOne({ _id: id, status: 'active' });
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');
  const [hydrated] = await hydratePosts([post], viewerId);
  return hydrated;
}

export async function getHashtagPosts(tag: string, page: number, viewerId?: string) {
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const norm = tag.replace(/^#/, '').toLowerCase();
  const filter = { hashtags: norm, status: 'active' as const };
  const [posts, total] = await Promise.all([
    Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE),
    Post.countDocuments(filter),
  ]);
  return { tag: norm, items: await hydratePosts(posts, viewerId), page: p, limit: PAGE_SIZE, total };
}

export async function deletePost(id: string, userId: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await Post.findById(id);
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');
  if (String(post.authorId) !== userId) throw AppError.forbidden('اجازه‌ی حذف ندارید', 'FORBIDDEN');
  const keys = [...post.images, post.beforeImage, post.afterImage].filter(Boolean) as string[];
  await Promise.all(keys.map((k) => storageProvider.delete(k).catch(() => undefined)));
  await Promise.all([
    PostComment.deleteMany({ postId: post._id }),
    PostLike.deleteMany({ postId: post._id }),
    SavedPost.deleteMany({ postId: post._id }),
    post.deleteOne(),
  ]);
  return { id };
}

// ───────────────────────────── saves / bookmarks ─────────────────────────
export async function toggleSave(postId: string, userId: string) {
  if (!Types.ObjectId.isValid(postId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await Post.findOne({ _id: postId, status: 'active' }).select('_id');
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');
  const existing = await SavedPost.findOne({ userId, postId });
  if (existing) {
    await existing.deleteOne();
    return { saved: false };
  }
  try {
    await SavedPost.create({ userId, postId });
  } catch {
    // Unique-index race → already saved.
  }
  return { saved: true };
}

/** The viewer's saved posts (active only), newest-saved first. */
export async function getSavedPosts(userId: string, page: number) {
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const [saves, total] = await Promise.all([
    SavedPost.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
    SavedPost.countDocuments({ userId }),
  ]);
  const posts = await Post.find({ _id: { $in: saves.map((s) => s.postId) }, status: 'active' });
  // Preserve the save order (newest saved first); drop removed posts.
  const byId = new Map(posts.map((post) => [String(post._id), post]));
  const ordered = saves.map((s) => byId.get(String(s.postId))).filter(Boolean) as IPost[];
  return { items: await hydratePosts(ordered, userId), page: p, limit: PAGE_SIZE, total };
}

// ───────────────────────────────── likes ─────────────────────────────────
export async function toggleLike(postId: string, userId: string) {
  if (!Types.ObjectId.isValid(postId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  await assertNotBanned(userId);
  const post = await Post.findOne({ _id: postId, status: 'active' });
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');

  const existing = await PostLike.findOne({ postId, userId });
  let liked: boolean;
  if (existing) {
    await existing.deleteOne();
    post.likeCount = Math.max(0, post.likeCount - 1);
    liked = false;
  } else {
    try {
      await PostLike.create({ postId, userId });
      post.likeCount += 1;
      liked = true;
    } catch {
      // Unique-index race (double tap) → treat as already liked.
      liked = true;
    }
  }
  await post.save();
  return { liked, likeCount: post.likeCount };
}

// ──────────────────────────────── comments ───────────────────────────────
export async function addComment(postId: string, userId: string, text: string) {
  if (!Types.ObjectId.isValid(postId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  await assertNotBanned(userId);
  const trimmed = text.trim();
  if (!trimmed) throw AppError.badRequest('متن کامنت خالی است', 'EMPTY_COMMENT');
  if (containsBannedWord(trimmed)) throw AppError.badRequest('کامنت شامل کلمه‌ی نامناسب است', 'PROFANITY');

  const post = await Post.findOne({ _id: postId, status: 'active' });
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');
  const comment = await PostComment.create({ postId, authorId: new Types.ObjectId(userId), text: trimmed });
  post.commentCount += 1;
  await post.save();

  const user = await User.findById(userId).select('firstName lastName profilePhoto').lean();
  const profile = await StylistProfile.findOne({ userId }).select('isVerified').lean();
  return serializeComment(comment, authorView(user, profile?.isVerified === true));
}

function serializeComment(c: { _id: unknown; text: string; createdAt: Date; authorId: unknown }, author: AuthorView) {
  return {
    id: String(c._id),
    text: c.text,
    author,
    authorId: String(c.authorId),
    createdAt: c.createdAt,
  };
}

export async function getComments(postId: string, page: number) {
  if (!Types.ObjectId.isValid(postId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const p = Math.max(1, page);
  const skip = (p - 1) * PAGE_SIZE;
  const filter = { postId, status: 'active' as const };
  const [comments, total] = await Promise.all([
    PostComment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(PAGE_SIZE).lean(),
    PostComment.countDocuments(filter),
  ]);
  const authorIds = [...new Set(comments.map((c) => String(c.authorId)))];
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: authorIds } }).select('userId isVerified').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const verifiedBy = new Map(profiles.map((pr) => [String(pr.userId), pr.isVerified === true]));
  return {
    items: comments.map((c) => {
      const uid = String(c.authorId);
      return serializeComment(c, authorView(userById.get(uid) ?? null, verifiedBy.get(uid) ?? false));
    }),
    page: p,
    limit: PAGE_SIZE,
    total,
  };
}

export async function deleteComment(commentId: string, userId: string, isAdmin: boolean) {
  if (!Types.ObjectId.isValid(commentId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const comment = await PostComment.findById(commentId);
  if (!comment) throw AppError.notFound('کامنت یافت نشد', 'COMMENT_NOT_FOUND');
  const post = await Post.findById(comment.postId).select('authorId');
  const isCommentAuthor = String(comment.authorId) === userId;
  const isPostAuthor = post && String(post.authorId) === userId;
  if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
    throw AppError.forbidden('اجازه‌ی حذف ندارید', 'FORBIDDEN');
  }
  await comment.deleteOne();
  if (post) await Post.updateOne({ _id: post._id }, { $inc: { commentCount: -1 } });
  return { id: commentId };
}

// ──────────────────────────────── reports ────────────────────────────────
export async function reportContent(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
) {
  if (!Types.ObjectId.isValid(targetId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const exists =
    targetType === 'post'
      ? await Post.exists({ _id: targetId })
      : targetType === 'story'
        ? await Story.exists({ _id: targetId })
        : await PostComment.exists({ _id: targetId });
  if (!exists) throw AppError.notFound('محتوا یافت نشد', 'TARGET_NOT_FOUND');
  try {
    await ContentReport.create({
      targetType,
      targetId: new Types.ObjectId(targetId),
      reporterId: new Types.ObjectId(reporterId),
      reason: reason.trim(),
    });
  } catch {
    // Duplicate (already reported by this user) → treat as success (idempotent).
  }
  return { reported: true };
}

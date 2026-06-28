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
import { Post, IPost } from '../../models/Post';
import { PostComment } from '../../models/PostComment';
import { PostLike } from '../../models/PostLike';
import { ContentReport, ReportTargetType } from '../../models/ContentReport';
import { User } from '../../models/User';
import { StylistProfile } from '../../models/StylistProfile';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { containsBannedWord } from '../../config/bannedWords';

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

function postView(p: IPost, author: AuthorView, likedByMe: boolean) {
  return {
    id: String(p._id),
    type: p.type,
    author,
    caption: p.caption,
    images: imageUrls(p.images),
    hashtags: p.hashtags,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe,
    createdAt: p.createdAt,
  };
}

/** Bulk-load authors (+ verified flag) and the viewer's likes for a set of posts. */
async function hydratePosts(posts: IPost[], viewerId?: string) {
  if (posts.length === 0) return [];
  const authorIds = [...new Set(posts.map((p) => String(p.authorId)))];
  const [users, profiles, likes] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: authorIds } }).select('userId isVerified').lean(),
    viewerId
      ? PostLike.find({ postId: { $in: posts.map((p) => p._id) }, userId: viewerId }).select('postId').lean()
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const verifiedBy = new Map(profiles.map((pr) => [String(pr.userId), pr.isVerified === true]));
  const likedSet = new Set(likes.map((l) => String(l.postId)));
  return posts.map((p) => {
    const uid = String(p.authorId);
    return postView(p, authorView(userById.get(uid) ?? null, verifiedBy.get(uid) ?? false), likedSet.has(String(p._id)));
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
  input: { caption: string; acceptedRules: boolean },
  files: Express.Multer.File[],
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
  if (!files || files.length === 0) throw AppError.badRequest('حداقل یک عکس لازم است', 'NO_IMAGES');
  if (files.length > MAX_IMAGES) throw AppError.badRequest(`حداکثر ${MAX_IMAGES} عکس مجاز است`, 'TOO_MANY_IMAGES');

  const caption = (input.caption ?? '').trim();
  if (containsBannedWord(caption)) {
    throw AppError.badRequest('متن شامل کلمه‌ی نامناسب است', 'PROFANITY');
  }

  const stored = await Promise.all(
    files.map((f) => storageProvider.save(f, { ownerType: 'post', ownerId: authorId, kind: 'social' })),
  );
  const post = await Post.create({
    authorId: new Types.ObjectId(authorId),
    type: 'photo',
    caption,
    images: stored.map((s) => s.path),
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
  await Promise.all(post.images.map((k) => storageProvider.delete(k).catch(() => undefined)));
  await Promise.all([
    PostComment.deleteMany({ postId: post._id }),
    PostLike.deleteMany({ postId: post._id }),
    post.deleteOne(),
  ]);
  return { id };
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

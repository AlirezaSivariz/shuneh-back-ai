/**
 * Ephemeral 24h photo stories for شونه‌گرام. Only gold-plan stylists create them;
 * everyone sees the active (non-expired, non-removed) ring. Expiry is enforced at
 * READ time (`expiresAt > now`) and by a cleanup job (`purgeExpiredStories`).
 */
import { Types } from 'mongoose';
import { Story } from '../../models/Story';
import { StoryView } from '../../models/StoryView';
import { User } from '../../models/User';
import { StylistProfile } from '../../models/StylistProfile';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { containsBannedWord } from '../../config/bannedWords';
import { getSocialAccess } from './social.service';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

interface AuthorView {
  id: string;
  fullName: string;
  profilePhoto: string | null;
  isVerified: boolean;
}

async function authorMap(authorIds: string[]): Promise<Map<string, AuthorView>> {
  const ids = [...new Set(authorIds)];
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: ids } }).select('userId isVerified').lean(),
  ]);
  const verified = new Map(profiles.map((p) => [String(p.userId), p.isVerified === true]));
  return new Map(
    users.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'متخصص',
        profilePhoto: u.profilePhoto ? storageProvider.getUrl(u.profilePhoto) : null,
        isVerified: verified.get(String(u._id)) ?? false,
      },
    ]),
  );
}

interface StoryRow {
  _id: unknown;
  image: string;
  caption: string;
  createdAt: Date;
  expiresAt: Date;
}

function storyView(s: StoryRow, seenByMe: boolean) {
  return {
    id: String(s._id),
    image: storageProvider.getUrl(s.image),
    caption: s.caption,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    seenByMe,
  };
}

const ACTIVE = () => ({ status: 'active' as const, expiresAt: { $gt: new Date() } });

// ───────────────────────────────── create ───────────────────────────────
export async function createStory(
  authorId: string,
  input: { caption: string; acceptedRules: boolean },
  file?: Express.Multer.File,
) {
  if (!input.acceptedRules) {
    throw AppError.badRequest('برای انتشار باید قوانین را بپذیرید', 'RULES_NOT_ACCEPTED');
  }
  const access = await getSocialAccess(authorId);
  if (access.banned) throw AppError.forbidden('حساب شما از شبکه‌ی اجتماعی مسدود شده است', 'SOCIAL_BANNED');
  if (!access.canPost) throw AppError.forbidden('انتشار استوری فقط برای پلن طلایی فعال است', 'SOCIAL_NOT_GOLD');
  if (!file) throw AppError.badRequest('عکس استوری لازم است', 'NO_IMAGE');

  const caption = (input.caption ?? '').trim();
  if (containsBannedWord(caption)) throw AppError.badRequest('متن شامل کلمه‌ی نامناسب است', 'PROFANITY');

  const stored = await storageProvider.save(file, { ownerType: 'story', ownerId: authorId, kind: 'social' });
  const now = new Date();
  const story = await Story.create({
    authorId: new Types.ObjectId(authorId),
    image: stored.path,
    caption,
    expiresAt: new Date(now.getTime() + STORY_TTL_MS),
  });
  return storyView(story, false);
}

// ───────────────────────── read (grouped story-row) ─────────────────────
/**
 * Active stories grouped per author (Instagram story-row). Authors with an
 * unseen story come first, each group's stories ordered chronologically.
 */
export async function getActiveStoriesGrouped(viewerId?: string) {
  const stories = await Story.find(ACTIVE()).sort({ createdAt: 1 }).lean();
  if (stories.length === 0) return [];

  const seenSet = viewerId
    ? new Set(
        (
          await StoryView.find({ storyId: { $in: stories.map((s) => s._id) }, viewerId })
            .select('storyId')
            .lean()
        ).map((v) => String(v.storyId)),
      )
    : new Set<string>();

  const authors = await authorMap(stories.map((s) => String(s.authorId)));

  const groups = new Map<string, { author: AuthorView; stories: ReturnType<typeof storyView>[]; hasUnseen: boolean; latestAt: number }>();
  for (const s of stories) {
    const uid = String(s.authorId);
    const author = authors.get(uid);
    if (!author) continue;
    const seen = seenSet.has(String(s._id));
    const g = groups.get(uid) ?? { author, stories: [], hasUnseen: false, latestAt: 0 };
    g.stories.push(storyView(s, seen));
    if (!seen) g.hasUnseen = true;
    g.latestAt = Math.max(g.latestAt, new Date(s.createdAt).getTime());
    groups.set(uid, g);
  }

  // Unseen groups first; within each bucket, most recent activity first.
  return [...groups.values()]
    .sort((a, b) => {
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.latestAt - a.latestAt;
    })
    .map((g) => ({ author: g.author, stories: g.stories, hasUnseen: g.hasUnseen }));
}

/** One author's active stories (chronological), for the fullscreen player. */
export async function getAuthorStories(authorId: string, viewerId?: string) {
  if (!Types.ObjectId.isValid(authorId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const stories = await Story.find({ authorId, ...ACTIVE() }).sort({ createdAt: 1 }).lean();
  const author = (await authorMap([authorId])).get(authorId) ?? null;
  const seenSet = viewerId
    ? new Set(
        (await StoryView.find({ storyId: { $in: stories.map((s) => s._id) }, viewerId }).select('storyId').lean()).map(
          (v) => String(v.storyId),
        ),
      )
    : new Set<string>();
  return { author, stories: stories.map((s) => storyView(s, seenSet.has(String(s._id)))) };
}

// ───────────────────────────────── seen ──────────────────────────────────
export async function markSeen(storyId: string, viewerId: string) {
  if (!Types.ObjectId.isValid(storyId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const story = await Story.findOne({ _id: storyId, ...ACTIVE() }).select('_id');
  if (!story) throw AppError.notFound('استوری یافت نشد', 'STORY_NOT_FOUND');
  try {
    await StoryView.create({ storyId, viewerId });
  } catch {
    // Unique (already seen) → no-op.
  }
  return { seen: true };
}

/** Viewers of a story — author only (privacy). */
export async function getStoryViewers(storyId: string, requesterId: string) {
  if (!Types.ObjectId.isValid(storyId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const story = await Story.findById(storyId).select('authorId');
  if (!story) throw AppError.notFound('استوری یافت نشد', 'STORY_NOT_FOUND');
  if (String(story.authorId) !== requesterId) throw AppError.forbidden('فقط نویسنده می‌تواند ببیند', 'FORBIDDEN');

  const views = await StoryView.find({ storyId }).sort({ seenAt: -1 }).lean();
  const authors = await authorMap(views.map((v) => String(v.viewerId)));
  return {
    count: views.length,
    viewers: views.map((v) => {
      const a = authors.get(String(v.viewerId));
      return {
        id: String(v.viewerId),
        fullName: a?.fullName ?? 'کاربر',
        profilePhoto: a?.profilePhoto ?? null,
        isVerified: a?.isVerified ?? false,
        seenAt: v.seenAt,
      };
    }),
  };
}

// ──────────────────────────────── delete ─────────────────────────────────
export async function deleteStory(id: string, userId: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const story = await Story.findById(id);
  if (!story) throw AppError.notFound('استوری یافت نشد', 'STORY_NOT_FOUND');
  if (String(story.authorId) !== userId) throw AppError.forbidden('اجازه‌ی حذف ندارید', 'FORBIDDEN');
  await storageProvider.delete(story.image).catch(() => undefined);
  await Promise.all([StoryView.deleteMany({ storyId: story._id }), story.deleteOne()]);
  return { id };
}

// ──────────────────────── cleanup job (expired) ──────────────────────────
/** Hard-delete expired stories (record + image + views). Returns the count. */
export async function purgeExpiredStories(): Promise<{ removed: number }> {
  const expired = await Story.find({ expiresAt: { $lte: new Date() } }).select('_id image').lean();
  if (expired.length === 0) return { removed: 0 };
  await Promise.all(expired.map((s) => storageProvider.delete(s.image).catch(() => undefined)));
  const ids = expired.map((s) => s._id);
  await Promise.all([Story.deleteMany({ _id: { $in: ids } }), StoryView.deleteMany({ storyId: { $in: ids } })]);
  return { removed: expired.length };
}

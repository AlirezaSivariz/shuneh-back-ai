/**
 * Community «پرسش و پاسخ» — a public Q&A forum backed by MongoDB. Anyone
 * signed-in may ask/like/save questions and answer; reads are public and get
 * personalized only when the viewer is authenticated (`isLiked`/`isSaved`).
 *
 * Data is durable (unlike the old in-memory web store), and the demo content is
 * seeded idempotently at boot (see `src/seed/community.seed.ts`).
 */
import { Types } from 'mongoose';
import { CommunityQuestion, ICommunityQuestion } from '../../models/CommunityQuestion';
import { CommunityAnswer, ICommunityAnswer } from '../../models/CommunityAnswer';
import { CommunityQuestionLike } from '../../models/CommunityQuestionLike';
import { CommunityAnswerLike } from '../../models/CommunityAnswerLike';
import { CommunityQuestionSave } from '../../models/CommunityQuestionSave';
import { User } from '../../models/User';
import { StylistProfile } from '../../models/StylistProfile';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { containsBannedWord } from '../../config/bannedWords';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface ListQuestionsInput {
  category?: string;
  sort?: 'latest' | 'popular' | 'unanswered';
  search?: string;
  page?: number;
  limit?: number;
}

// ───────────────────────────── serialization ─────────────────────────────

export interface CommunityAuthorView {
  id: string;
  fullName: string;
  profilePhoto: string | null;
  isVerified: boolean;
  isSpecialist: boolean;
  rating?: number;
  ratingCount?: number;
  username?: string | null;
}

interface UserLite {
  _id: unknown;
  firstName?: string | null;
  lastName?: string | null;
  profilePhoto?: string | null;
}

interface ProfileLite {
  userId: unknown;
  isVerified?: boolean;
  username?: string;
  ratingAverage?: number;
  ratingCount?: number;
}

function authorView(
  user: UserLite | null,
  profile?: ProfileLite | null,
): CommunityAuthorView {
  const isSpecialist = !!profile;
  const view: CommunityAuthorView = {
    id: user ? String(user._id) : '',
    fullName: user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'کاربر شونه' : 'حذف‌شده',
    profilePhoto: user?.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
    isVerified: profile?.isVerified === true,
    isSpecialist,
  };
  if (profile?.username) view.username = profile.username;
  if (isSpecialist) {
    view.rating = profile!.ratingAverage ?? 0;
    view.ratingCount = profile!.ratingCount ?? 0;
  }
  return view;
}

function questionView(
  q: { _id: unknown; title: string; content: string; category: string; answerCount: number; viewCount: number; likeCount: number; createdAt: Date },
  author: CommunityAuthorView,
  liked: boolean,
  saved: boolean,
) {
  return {
    id: String(q._id),
    title: q.title,
    content: q.content,
    category: q.category,
    author,
    answerCount: q.answerCount,
    viewCount: q.viewCount,
    likeCount: q.likeCount,
    isLiked: liked,
    isSaved: saved,
    createdAt: q.createdAt,
  };
}

function answerView(
  a: { _id: unknown; questionId: unknown; content: string; isVerifiedAnswer: boolean; likeCount: number; createdAt: Date },
  author: CommunityAuthorView,
  liked: boolean,
) {
  return {
    id: String(a._id),
    questionId: String(a.questionId),
    content: a.content,
    author,
    isVerifiedAnswer: a.isVerifiedAnswer,
    likeCount: a.likeCount,
    isLiked: liked,
    createdAt: a.createdAt,
  };
}

/**
 * Batch-load authors (+ verification/specialist view) and the viewer's
 * likes/saves for a set of questions. A few queries regardless of size.
 */
async function hydrateQuestions(
  questions: { _id: unknown; authorId: unknown; title: string; content: string; category: string; answerCount: number; viewCount: number; likeCount: number; createdAt: Date }[],
  viewerId?: string,
) {
  if (questions.length === 0) return [];
  const authorIds = [...new Set(questions.map((q) => String(q.authorId)))];
  const questionIds = questions.map((q) => q._id);
  const [users, profiles, likes, saves] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: authorIds } })
      .select('userId isVerified username ratingAverage ratingCount')
      .lean(),
    viewerId
      ? CommunityQuestionLike.find({ questionId: { $in: questionIds }, userId: viewerId })
          .select('questionId')
          .lean()
      : Promise.resolve([]),
    viewerId
      ? CommunityQuestionSave.find({ questionId: { $in: questionIds }, userId: viewerId })
          .select('questionId')
          .lean()
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const profileByUserId = new Map(profiles.map((p) => [String(p.userId), p]));
  const likedSet = new Set(likes.map((l) => String(l.questionId)));
  const savedSet = new Set(saves.map((s) => String(s.questionId)));
  return questions.map((q) =>
    questionView(
      q,
      authorView(userById.get(String(q.authorId)) ?? null, profileByUserId.get(String(q.authorId)) ?? null),
      likedSet.has(String(q._id)),
      savedSet.has(String(q._id)),
    ),
  );
}

/** Batch-load authors + the viewer's answer-likes for a set of answers. */
async function hydrateAnswers(
  answers: ICommunityAnswer[],
  viewerId?: string,
) {
  if (answers.length === 0) return [];
  const authorIds = [...new Set(answers.map((a) => String(a.authorId)))];
  const answerIds = answers.map((a) => a._id);
  const [users, profiles, likes] = await Promise.all([
    User.find({ _id: { $in: authorIds } }).select('firstName lastName profilePhoto').lean(),
    StylistProfile.find({ userId: { $in: authorIds } })
      .select('userId isVerified username ratingAverage ratingCount')
      .lean(),
    viewerId
      ? CommunityAnswerLike.find({ answerId: { $in: answerIds }, userId: viewerId })
          .select('answerId')
          .lean()
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const profileByUserId = new Map(profiles.map((p) => [String(p.userId), p]));
  const likedSet = new Set(likes.map((l) => String(l.answerId)));
  return answers.map((a) =>
    answerView(
      a,
      authorView(userById.get(String(a.authorId)) ?? null, profileByUserId.get(String(a.authorId)) ?? null),
      likedSet.has(String(a._id)),
    ),
  );
}

// ───────────────────────────── helpers ─────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Community writes share the social-network moderation flag (User.socialBanned). */
async function assertNotBanned(userId: string) {
  const user = await User.findById(userId).select('socialBanned').lean();
  if (user?.socialBanned) {
    throw AppError.forbidden('حساب شما از مشارکت در انجمن مسدود شده است', 'SOCIAL_BANNED');
  }
}

// ───────────────────────────── questions ─────────────────────────────

export async function listQuestions(input: ListQuestionsInput, viewerId?: string) {
  const sort = input.sort ?? 'latest';
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const match: Record<string, unknown> = { status: 'active' };
  if (input.category) match.category = input.category;
  if (input.search) {
    const rx = new RegExp(escapeRegex(input.search), 'i');
    match.$or = [{ title: rx }, { content: rx }];
  }
  if (sort === 'unanswered') match.answerCount = 0;

  const [rows, total] =
    sort === 'popular'
      ? await Promise.all([
          CommunityQuestion.aggregate<ICommunityQuestion>([
            { $match: match },
            {
              $addFields: {
                score: { $add: ['$likeCount', { $multiply: ['$answerCount', 2] }] },
              },
            },
            { $sort: { score: -1, createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
          ]),
          CommunityQuestion.countDocuments(match),
        ])
      : await Promise.all([
          CommunityQuestion.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit),
          CommunityQuestion.countDocuments(match),
        ]);

  return {
    items: await hydrateQuestions(rows, viewerId),
    page,
    limit,
    total,
  };
}

export async function getQuestion(id: string, viewerId?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const q = await CommunityQuestion.findOne({ _id: id, status: 'active' });
  if (!q) throw AppError.notFound('پرسش یافت نشد', 'QUESTION_NOT_FOUND');

  // Every read counts as a view (matches the legacy in-memory behavior).
  q.viewCount += 1;
  await CommunityQuestion.updateOne({ _id: q._id }, { $inc: { viewCount: 1 } });

  const answers = await CommunityAnswer.find({ questionId: q._id, status: 'active' }).sort({
    createdAt: 1,
  });
  const [question] = await hydrateQuestions([q], viewerId);
  const answerItems = await hydrateAnswers(answers, viewerId);
  return { question, answers: answerItems };
}

export async function createQuestion(
  authorId: string,
  input: { title: string; content: string; category: string },
) {
  await assertNotBanned(authorId);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw AppError.badRequest('عنوان سوال لازم است', 'EMPTY_TITLE');
  if (!content) throw AppError.badRequest('توضیحات سوال لازم است', 'EMPTY_CONTENT');
  if (containsBannedWord(title) || containsBannedWord(content)) {
    throw AppError.badRequest('متن شامل کلمه‌ی نامناسب است', 'PROFANITY');
  }

  const q = await CommunityQuestion.create({
    authorId: new Types.ObjectId(authorId),
    title,
    content,
    category: input.category,
  });
  const [view] = await hydrateQuestions([q], authorId);
  return view;
}

// ───────────────────────────── answers ─────────────────────────────

export async function addAnswer(questionId: string, authorId: string, content: string) {
  if (!Types.ObjectId.isValid(questionId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  await assertNotBanned(authorId);
  const trimmed = content.trim();
  if (!trimmed) throw AppError.badRequest('متن پاسخ خالی است', 'EMPTY_ANSWER');
  if (containsBannedWord(trimmed)) {
    throw AppError.badRequest('متن شامل کلمه‌ی نامناسب است', 'PROFANITY');
  }

  const q = await CommunityQuestion.findOne({ _id: questionId, status: 'active' }).select('_id');
  if (!q) throw AppError.notFound('پرسش یافت نشد', 'QUESTION_NOT_FOUND');

  const answer = await CommunityAnswer.create({
    questionId: new Types.ObjectId(questionId),
    authorId: new Types.ObjectId(authorId),
    content: trimmed,
  });
  await CommunityQuestion.updateOne({ _id: q._id }, { $inc: { answerCount: 1 } });
  return { id: String(answer._id) };
}

// ───────────────────────────── likes / saves ─────────────────────────────

export async function toggleLikeQuestion(questionId: string, userId: string) {
  if (!Types.ObjectId.isValid(questionId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  await assertNotBanned(userId);
  const q = await CommunityQuestion.findOne({ _id: questionId, status: 'active' });
  if (!q) throw AppError.notFound('پرسش یافت نشد', 'QUESTION_NOT_FOUND');

  const existing = await CommunityQuestionLike.findOne({ questionId, userId });
  let liked: boolean;
  if (existing) {
    await existing.deleteOne();
    await CommunityQuestion.updateOne({ _id: q._id, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
    liked = false;
  } else {
    try {
      await CommunityQuestionLike.create({ questionId, userId });
    } catch {
      // Unique-index race (double tap) → treat as already liked.
    }
    await CommunityQuestion.updateOne({ _id: q._id }, { $inc: { likeCount: 1 } });
    liked = true;
  }
  const q2 = await CommunityQuestion.findById(q._id).select('likeCount').lean();
  return { liked, likeCount: q2?.likeCount ?? q.likeCount };
}

export async function toggleSaveQuestion(questionId: string, userId: string) {
  if (!Types.ObjectId.isValid(questionId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const q = await CommunityQuestion.findOne({ _id: questionId, status: 'active' }).select('_id');
  if (!q) throw AppError.notFound('پرسش یافت نشد', 'QUESTION_NOT_FOUND');

  const existing = await CommunityQuestionSave.findOne({ userId, questionId });
  if (existing) {
    await existing.deleteOne();
    return { saved: false };
  }
  try {
    await CommunityQuestionSave.create({ userId, questionId });
  } catch {
    // Unique-index race → already saved.
  }
  return { saved: true };
}

export async function toggleLikeAnswer(answerId: string, userId: string) {
  if (!Types.ObjectId.isValid(answerId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  await assertNotBanned(userId);
  const answer = await CommunityAnswer.findOne({ _id: answerId, status: 'active' });
  if (!answer) throw AppError.notFound('پاسخ یافت نشد', 'ANSWER_NOT_FOUND');

  const existing = await CommunityAnswerLike.findOne({ answerId, userId });
  let liked: boolean;
  if (existing) {
    await existing.deleteOne();
    await CommunityAnswer.updateOne({ _id: answer._id, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
    liked = false;
  } else {
    try {
      await CommunityAnswerLike.create({ answerId, userId });
    } catch {
      // Unique-index race (double tap) → treat as already liked.
    }
    await CommunityAnswer.updateOne({ _id: answer._id }, { $inc: { likeCount: 1 } });
    liked = true;
  }
  const a2 = await CommunityAnswer.findById(answer._id).select('likeCount').lean();
  return { liked, likeCount: a2?.likeCount ?? answer.likeCount };
}

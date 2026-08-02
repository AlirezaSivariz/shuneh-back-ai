import { Types } from 'mongoose';
import { User } from '../models/User';
import { CommunityQuestion } from '../models/CommunityQuestion';
import { CommunityAnswer } from '../models/CommunityAnswer';
import { CommunityQuestionLike } from '../models/CommunityQuestionLike';
import { CommunityQuestionSave } from '../models/CommunityQuestionSave';
import { SEED_COMMUNITY_USERS, SEED_COMMUNITY_QUESTIONS } from './community.data';

/**
 * Idempotent seeding of the community Q&A demo content.
 *
 * Every entity is matched by a stable key (`phone` for users, `seedKey` for
 * questions/answers, the unique (questionId,userId) pair for likes/saves) and
 * only ever INSERTED with `$setOnInsert` — re-running never duplicates and
 * NEVER overwrites live data (a seeded question that gained user answers/likes
 * is left exactly as-is). Safe to call on every boot.
 *
 * Returns counters so boot logs stay informative.
 */
export async function seedCommunity(): Promise<{
  users: number;
  questions: number;
  answers: number;
  likes: number;
}> {
  const userByKey = new Map<string, string>();

  for (const u of SEED_COMMUNITY_USERS) {
    const doc = await User.findOneAndUpdate(
      { phone: u.phone },
      {
        $setOnInsert: {
          phone: u.phone,
          firstName: u.firstName,
          lastName: u.lastName,
          roles: ['customer'],
          isActive: true,
        },
      },
      { upsert: true, new: true },
    ).select('_id');
    userByKey.set(u.key, String(doc._id));
  }

  const questionIdByKey = new Map<string, string>();
  let questions = 0;

  for (const q of SEED_COMMUNITY_QUESTIONS) {
    const authorId = userByKey.get(q.authorKey)!;
    const createdAt = new Date(Date.now() - q.daysAgo * 86400000);
    const doc = await CommunityQuestion.findOneAndUpdate(
      { seedKey: q.seedKey },
      {
        $setOnInsert: {
          seedKey: q.seedKey,
          authorId: new Types.ObjectId(authorId),
          title: q.title,
          content: q.content,
          category: q.category,
          viewCount: q.viewCount,
          likeCount: 0,
          answerCount: 0,
          status: 'active',
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true, new: true, timestamps: false },
    ).select('_id');
    questionIdByKey.set(q.seedKey, String(doc._id));
    questions += 1;
  }

  let answers = 0;
  for (const q of SEED_COMMUNITY_QUESTIONS) {
    const questionId = questionIdByKey.get(q.seedKey)!;
    for (const a of q.answers) {
      if (await CommunityAnswer.exists({ seedKey: a.seedKey })) continue;
      const authorId = userByKey.get(a.authorKey)!;
      const createdAt = new Date(Date.now() - a.daysAgo * 86400000);
      await CommunityAnswer.create({
        seedKey: a.seedKey,
        questionId,
        authorId: new Types.ObjectId(authorId),
        content: a.content,
        isVerifiedAnswer: a.isVerifiedAnswer === true,
        likeCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
      await CommunityQuestion.updateOne({ _id: questionId }, { $inc: { answerCount: 1 } });
      answers += 1;
    }
  }

  let likes = 0;
  for (const q of SEED_COMMUNITY_QUESTIONS) {
    const questionId = questionIdByKey.get(q.seedKey)!;
    for (const key of q.likeKeys) {
      const userId = userByKey.get(key)!;
      const res = await CommunityQuestionLike.updateOne(
        { questionId, userId },
        { $setOnInsert: { questionId, userId } },
        { upsert: true },
      );
      if ((res as { upsertedCount?: number }).upsertedCount) {
        await CommunityQuestion.updateOne({ _id: questionId }, { $inc: { likeCount: 1 } });
        likes += 1;
      }
    }
    for (const key of q.saveKeys) {
      const userId = userByKey.get(key)!;
      await CommunityQuestionSave.updateOne(
        { userId, questionId },
        { $setOnInsert: { userId, questionId } },
        { upsert: true },
      );
    }
  }

  return { users: SEED_COMMUNITY_USERS.length, questions, answers, likes };
}

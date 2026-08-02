import { api, auth, login } from './helpers';
import { seedCommunity } from '../src/seed/community.seed';
import { SEED_COMMUNITY_QUESTIONS, SEED_COMMUNITY_USERS } from '../src/seed/community.data';
import { CommunityQuestion } from '../src/models/CommunityQuestion';
import { CommunityAnswer } from '../src/models/CommunityAnswer';
import { User } from '../src/models/User';

describe('community seed', () => {
  it('is idempotent and never duplicates', async () => {
    const first = await seedCommunity();
    expect(first.questions).toBe(SEED_COMMUNITY_QUESTIONS.length);
    expect(first.answers).toBe(SEED_COMMUNITY_QUESTIONS.length * 3);
    expect(first.users).toBe(SEED_COMMUNITY_USERS.length);
    expect(await CommunityQuestion.countDocuments()).toBe(SEED_COMMUNITY_QUESTIONS.length);
    expect(await CommunityAnswer.countDocuments()).toBe(SEED_COMMUNITY_QUESTIONS.length * 3);
    expect(await User.countDocuments({ phone: /^\+9891/ })).toBe(SEED_COMMUNITY_USERS.length);

    // Second run inserts nothing new and leaves counts untouched.
    const second = await seedCommunity();
    expect(second.questions).toBe(SEED_COMMUNITY_QUESTIONS.length);
    expect(second.answers).toBe(0);
    expect(second.likes).toBe(0);
    expect(await CommunityQuestion.countDocuments()).toBe(SEED_COMMUNITY_QUESTIONS.length);
    expect(await CommunityAnswer.countDocuments()).toBe(SEED_COMMUNITY_QUESTIONS.length * 3);
  });

  it('re-seeding never wipes user-created data', async () => {
    await seedCommunity();
    const { token } = await login();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);
    await api()
      .post(`/community/questions/${id}/answers`)
      .set(...auth(token))
      .send({ content: 'پاسخ کاربر' })
      .expect(201);

    await seedCommunity();

    expect(await CommunityAnswer.countDocuments({ content: 'پاسخ کاربر' })).toBe(1);
    const q2 = await CommunityQuestion.findById(id).lean();
    expect(q2!.answerCount).toBe(4);
  });
});

describe('GET /community/questions', () => {
  it('lists seeded questions with the expected client shape', async () => {
    await seedCommunity();
    const res = await api().get('/community/questions').expect(200);
    expect(res.body.success).toBe(true);
    const { items, total, page, limit } = res.body.data;
    expect(total).toBe(SEED_COMMUNITY_QUESTIONS.length);
    expect(items).toHaveLength(SEED_COMMUNITY_QUESTIONS.length);
    expect(page).toBe(1);
    expect(limit).toBe(20);
    const q = items[0];
    expect(q).toMatchObject({
      title: expect.any(String),
      content: expect.any(String),
      category: expect.any(String),
      answerCount: 3,
      viewCount: expect.any(Number),
      likeCount: expect.any(Number),
      isLiked: false,
      isSaved: false,
      createdAt: expect.any(String),
    });
    expect(q.author).toMatchObject({
      id: expect.any(String),
      fullName: expect.any(String),
      isSpecialist: false,
    });
    expect(q).not.toHaveProperty('_answers');
  });

  it('filters by category', async () => {
    await seedCommunity();
    const res = await api().get('/community/questions?category=skin').expect(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.every((q: { category: string }) => q.category === 'skin')).toBe(true);
  });

  it('search matches title content', async () => {
    await seedCommunity();
    const res = await api()
      .get(`/community/questions?search=${encodeURIComponent('کراتین')}`)
      .expect(200);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  it('unanswered sort returns only questions with zero answers', async () => {
    await seedCommunity();
    const res = await api().get('/community/questions?sort=unanswered').expect(200);
    expect(res.body.data.total).toBe(0); // every seeded question has 3 answers
  });

  it('popular sort ranks by likeCount + answerCount*2', async () => {
    await seedCommunity();
    const res = await api().get('/community/questions?sort=popular').expect(200);
    const scores = res.body.data.items.map(
      (q: { likeCount: number; answerCount: number }) => q.likeCount + q.answerCount * 2,
    );
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});

describe('GET /community/questions/:id', () => {
  it('returns the question with its answers and bumps viewCount', async () => {
    await seedCommunity();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);
    const before = q!.viewCount;

    const res = await api().get(`/community/questions/${id}`).expect(200);
    expect(res.body.data.question.id).toBe(id);
    expect(res.body.data.question.answerCount).toBe(3);
    expect(res.body.data.question.viewCount).toBe(before + 1);
    expect(res.body.data.answers).toHaveLength(3);
    const a = res.body.data.answers[0];
    expect(a).toMatchObject({
      questionId: id,
      content: expect.any(String),
      isVerifiedAnswer: expect.any(Boolean),
      isLiked: false,
    });
  });

  it('404s for a missing question', async () => {
    const res = await api().get('/community/questions/000000000000000000000000').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('QUESTION_NOT_FOUND');
  });
});

describe('community writes', () => {
  it('requires authentication for all writes', async () => {
    await seedCommunity();
    await api()
      .post('/community/questions')
      .send({ title: 'سوال', content: 'متن', category: 'skin' })
      .expect(401);
    await api().post('/community/questions/000000000000000000000000/like').expect(401);
    await api().post('/community/questions/000000000000000000000000/save').expect(401);
    await api()
      .post('/community/questions/000000000000000000000000/answers')
      .send({ content: 'پاسخ' })
      .expect(401);
    await api().post('/community/answers/000000000000000000000000/like').expect(401);
  });

  it('creates a question as the signed-in user', async () => {
    const { token, user } = await login();
    const res = await api()
      .post('/community/questions')
      .set(...auth(token))
      .send({ title: 'سوال تستی', content: 'متن تستی سوال برای آزمون', category: 'skin' })
      .expect(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.author.id).toBe(user.id);
    expect(res.body.data.answerCount).toBe(0);
    expect(res.body.data.isLiked).toBe(false);
    expect(await CommunityQuestion.countDocuments()).toBe(1);
  });

  it('rejects empty/profane content', async () => {
    const { token } = await login();
    await api()
      .post('/community/questions')
      .set(...auth(token))
      .send({ title: '', content: 'متن', category: 'skin' })
      .expect(400);
    await api()
      .post('/community/questions')
      .set(...auth(token))
      .send({ title: 'سوال', content: 'جملات کثیف fuck', category: 'skin' })
      .expect(400);
  });

  it('adds an answer and increments answerCount', async () => {
    await seedCommunity();
    const { token } = await login();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);

    const res = await api()
      .post(`/community/questions/${id}/answers`)
      .set(...auth(token))
      .send({ content: 'پاسخ تستی' })
      .expect(201);
    expect(res.body.data.id).toBeTruthy();

    const q2 = await CommunityQuestion.findById(id).lean();
    expect(q2!.answerCount).toBe(4);
  });
});

describe('community likes / saves (per-user)', () => {
  it('toggles question likes per user with correct counts', async () => {
    await seedCommunity();
    const u1 = await login();
    const u2 = await login();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);
    // Seeded questions already carry 3 likes from other demo users.
    const base = q!.likeCount;

    const like1 = await api()
      .post(`/community/questions/${id}/like`)
      .set(...auth(u1.token))
      .expect(200);
    expect(like1.body.data).toEqual({ liked: true, likeCount: base + 1 });

    const like2 = await api()
      .post(`/community/questions/${id}/like`)
      .set(...auth(u2.token))
      .expect(200);
    expect(like2.body.data).toEqual({ liked: true, likeCount: base + 2 });

    // Viewer-specific isLiked on reads.
    const detail1 = await api().get(`/community/questions/${id}`).set(...auth(u1.token)).expect(200);
    expect(detail1.body.data.question.isLiked).toBe(true);
    const detail2 = await api().get(`/community/questions/${id}`).set(...auth(u2.token)).expect(200);
    expect(detail2.body.data.question.isLiked).toBe(true);
    const detailAnon = await api().get(`/community/questions/${id}`).expect(200);
    expect(detailAnon.body.data.question.isLiked).toBe(false);

    const unlike = await api()
      .post(`/community/questions/${id}/like`)
      .set(...auth(u1.token))
      .expect(200);
    expect(unlike.body.data).toEqual({ liked: false, likeCount: base + 1 });
  });

  it('toggles saves per user', async () => {
    await seedCommunity();
    const { token } = await login();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);

    const save = await api()
      .post(`/community/questions/${id}/save`)
      .set(...auth(token))
      .expect(200);
    expect(save.body.data).toEqual({ saved: true });

    const detail = await api().get(`/community/questions/${id}`).set(...auth(token)).expect(200);
    expect(detail.body.data.question.isSaved).toBe(true);

    const unsave = await api()
      .post(`/community/questions/${id}/save`)
      .set(...auth(token))
      .expect(200);
    expect(unsave.body.data).toEqual({ saved: false });
  });

  it('toggles answer likes per user', async () => {
    await seedCommunity();
    const u1 = await login();
    const q = await CommunityQuestion.findOne({ seedKey: 'q1' });
    const id = String(q!._id);
    const answerId = String((await CommunityAnswer.findOne({ seedKey: 'q1-a1' }))!._id);

    const like = await api()
      .post(`/community/answers/${answerId}/like`)
      .set(...auth(u1.token))
      .expect(200);
    expect(like.body.data).toEqual({ liked: true, likeCount: 1 });

    const detail = await api().get(`/community/questions/${id}`).set(...auth(u1.token)).expect(200);
    const liked = detail.body.data.answers.find((a: { id: string }) => a.id === answerId);
    expect(liked.isLiked).toBe(true);

    const unlike = await api()
      .post(`/community/answers/${answerId}/like`)
      .set(...auth(u1.token))
      .expect(200);
    expect(unlike.body.data).toEqual({ liked: false, likeCount: 0 });
  });
});

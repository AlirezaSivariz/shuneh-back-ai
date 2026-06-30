import { Request, Response } from 'express';
import * as service from './social.service';
import * as storyService from './story.service';
import { sendSuccess } from '../../utils/response';

const pageOf = (q: unknown) => {
  const p = (q as { page?: number }).page;
  return p ? Number(p) : 1;
};

export async function access(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getSocialAccess(req.user?.id));
}

export async function createPost(req: Request, res: Response): Promise<void> {
  // `.fields()` → req.files is an object keyed by field name.
  const files = (req.files as service.PostFiles | undefined) ?? {};
  const post = await service.createPost(
    req.user!.id,
    {
      caption: req.body.caption ?? '',
      acceptedRules: req.body.acceptedRules,
      type: req.body.type,
      relatedServiceId: req.body.relatedServiceId || null,
    },
    files,
  );
  sendSuccess(res, { post }, 201);
}

export async function toggleSave(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleSave(req.params.id, req.user!.id));
}

export async function savedPosts(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getSavedPosts(req.user!.id, pageOf(req.query)));
}

export async function feed(req: Request, res: Response): Promise<void> {
  const mode = (req.query as { mode?: string }).mode === 'following' ? 'following' : 'all';
  sendSuccess(res, await service.getFeed(pageOf(req.query), req.user?.id, mode));
}

// ── Follow / unfollow ──
export async function toggleFollow(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleFollow(req.user!.id, req.params.id));
}

export async function followersCount(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getFollowersCount(req.params.id));
}

export async function following(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getFollowing(req.user!.id));
}

export async function getPost(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { post: await service.getPostById(req.params.id, req.user?.id) });
}

export async function hashtag(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getHashtagPosts(req.params.tag, pageOf(req.query), req.user?.id));
}

export async function deletePost(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.deletePost(req.params.id, req.user!.id));
}

export async function like(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleLike(req.params.id, req.user!.id));
}

export async function addComment(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { comment: await service.addComment(req.params.id, req.user!.id, req.body.text) }, 201);
}

export async function comments(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getComments(req.params.id, pageOf(req.query)));
}

export async function deleteComment(req: Request, res: Response): Promise<void> {
  const isAdmin = (req.user?.roles ?? []).includes('admin');
  sendSuccess(res, await service.deleteComment(req.params.id, req.user!.id, isAdmin));
}

export async function report(req: Request, res: Response): Promise<void> {
  const { targetType, targetId, reason } = req.body;
  sendSuccess(res, await service.reportContent(req.user!.id, targetType, targetId, reason), 201);
}

// ── Stories ──
export async function createStory(req: Request, res: Response): Promise<void> {
  const story = await storyService.createStory(
    req.user!.id,
    { caption: req.body.caption ?? '', acceptedRules: req.body.acceptedRules },
    req.file,
  );
  sendSuccess(res, { story }, 201);
}

export async function storiesFeed(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { groups: await storyService.getActiveStoriesGrouped(req.user?.id) });
}

export async function authorStories(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await storyService.getAuthorStories(req.params.authorId, req.user?.id));
}

export async function deleteStory(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await storyService.deleteStory(req.params.id, req.user!.id));
}

export async function markStorySeen(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await storyService.markSeen(req.params.id, req.user!.id));
}

export async function storyViewers(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await storyService.getStoryViewers(req.params.id, req.user!.id));
}

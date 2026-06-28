import { Request, Response } from 'express';
import * as service from './social.service';
import { sendSuccess } from '../../utils/response';

const pageOf = (q: unknown) => {
  const p = (q as { page?: number }).page;
  return p ? Number(p) : 1;
};

export async function access(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getSocialAccess(req.user?.id));
}

export async function createPost(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const post = await service.createPost(
    req.user!.id,
    { caption: req.body.caption ?? '', acceptedRules: req.body.acceptedRules },
    files,
  );
  sendSuccess(res, { post }, 201);
}

export async function feed(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getFeed(pageOf(req.query), req.user?.id));
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

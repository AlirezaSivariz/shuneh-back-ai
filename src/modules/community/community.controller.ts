import { Request, Response } from 'express';
import * as service from './community.service';
import { sendSuccess } from '../../utils/response';

export async function listQuestions(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await service.listQuestions(
      {
        category: req.query.category as string | undefined,
        sort: req.query.sort as 'latest' | 'popular' | 'unanswered' | undefined,
        search: req.query.search as string | undefined,
        page: req.query.page as number | undefined,
        limit: req.query.limit as number | undefined,
      },
      req.user?.id,
    ),
  );
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getQuestion(req.params.id, req.user?.id));
}

export async function createQuestion(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.createQuestion(req.user!.id, req.body), 201);
}

export async function addAnswer(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.addAnswer(req.params.id, req.user!.id, req.body.content), 201);
}

export async function likeQuestion(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleLikeQuestion(req.params.id, req.user!.id));
}

export async function saveQuestion(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleSaveQuestion(req.params.id, req.user!.id));
}

export async function likeAnswer(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.toggleLikeAnswer(req.params.id, req.user!.id));
}

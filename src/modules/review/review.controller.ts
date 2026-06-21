import { Request, Response } from 'express';
import * as service from './review.service';
import { sendSuccess } from '../../utils/response';

export async function create(req: Request, res: Response): Promise<void> {
  const review = await service.createReview(req.user!.id, req.params.id, req.body);
  sendSuccess(res, { review }, 201);
}

export async function getForReservation(req: Request, res: Response): Promise<void> {
  const review = await service.getReviewForReservation(req.user!.id, req.params.id);
  sendSuccess(res, { review });
}

export async function listForStylist(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as unknown as { page?: number; limit?: number };
  // req.user is set only when a valid token is present (optionalAuthenticate).
  const result = await service.listStylistReviews(req.params.id, page ?? 1, limit ?? 10, req.user?.id);
  sendSuccess(res, result);
}

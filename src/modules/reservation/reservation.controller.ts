import { Request, Response } from 'express';
import * as service from './reservation.service';
import { sendSuccess } from '../../utils/response';

/**
 * Manually trigger the auto-complete pass (for tests / ops). Uses the exact
 * same service the scheduled job calls.
 */
export async function completeDue(_req: Request, res: Response): Promise<void> {
  const result = await service.completeDueReservations();
  sendSuccess(res, result);
}

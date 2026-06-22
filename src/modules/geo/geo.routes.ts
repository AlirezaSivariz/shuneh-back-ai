import { Router, Request, Response } from 'express';
import { iranProvinces } from '../../data/iranGeo';
import { sendSuccess } from '../../utils/response';

// Public, static reference data: Iran provinces & cities (+ center coords).
// Used by the frontend for the province→city selects and map starting point.
const router = Router();

router.get('/provinces', (_req: Request, res: Response) => {
  // Immutable static data → allow long-lived caching by the browser/CDN.
  res.set('Cache-Control', 'public, max-age=86400');
  sendSuccess(res, { provinces: iranProvinces });
});

export default router;

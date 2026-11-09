import { Request, Response } from 'express';
import * as service from './coupon.service';
import * as discountService from '../discount/discount.service';
import { sendSuccess } from '../../utils/response';

// ── Admin ──
export async function create(req: Request, res: Response): Promise<void> {
  const coupon = await service.createCoupon(req.user!.id, req.body);
  sendSuccess(res, { coupon }, 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  const result = await service.listCoupons({
    search: q.search,
    campaign: q.campaign as never,
    isActive: q.isActive === undefined ? undefined : q.isActive === 'true',
    page: Number(q.page),
    limit: Number(q.limit),
  });
  sendSuccess(res, result);
}

export async function update(req: Request, res: Response): Promise<void> {
  const coupon = await service.updateCoupon(req.user!.id, req.params.id, req.body);
  sendSuccess(res, { coupon });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const coupon = await service.setCouponStatus(req.user!.id, req.params.id, req.body.isActive);
  sendSuccess(res, { coupon });
}

export async function remove(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.deleteCoupon(req.user!.id, req.params.id));
}

// ── Customer ──
/**
 * Preview a platform coupon for a prospective booking (no writes). The preview
 * mirrors booking math: items are priced for the stylist, any valid stylist
 * discount is applied first, then the coupon discount is computed.
 */
export async function preview(req: Request, res: Response): Promise<void> {
  const {
    code,
    stylistId,
    serviceIds,
    date,
    startTime,
    companionsCount,
    discountCode,
  } = req.body as {
    code: string;
    stylistId: string;
    serviceIds: string[];
    date: string;
    startTime: string;
    companionsCount?: number;
    discountCode?: string;
  };

  const items = await discountService.resolveItems(stylistId, serviceIds);
  const persons = 1 + (companionsCount ?? 0);
  const baseTotal = items.reduce((s, i) => s + i.price, 0);
  const gross = baseTotal * persons;

  let stylistDiscount = 0;
  // Mirror the booking flow exactly: the stylist discount is computed on the
  // unmultiplied item total, so with companions the coupon base is the
  // discounted single-person price (the same value the reservation service uses).
  let priceBeforeCoupon = gross;
  if (discountCode) {
    try {
      const preview = await discountService.previewDiscount(stylistId, {
        code: discountCode,
        serviceIds,
        date,
        startTime,
      });
      if (preview.valid) {
        stylistDiscount = preview.discountAmount;
        priceBeforeCoupon = Math.max(0, baseTotal - preview.discountAmount);
      }
    } catch {
      // An invalid stylist code simply doesn't affect the coupon preview.
    }
  }

  const result = await service.previewCoupon(req.user!.id, {
    code,
    stylistId,
    items,
    persons,
    priceBeforeCoupon,
  });
  sendSuccess(res, { ...result, stylistDiscount, originalPrice: gross });
}

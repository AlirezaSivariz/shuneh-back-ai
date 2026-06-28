import { z } from 'zod';
import { ROLES } from '../../models/User';
import { RESERVATION_STATUSES } from '../../models/Reservation';
import { SERVICE_GENDERS } from '../../models/Salon';
import { isValidHHmm } from '../../utils/time';
import { findProvince, isValidProvinceCity } from '../../data/iranGeo';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const pageQuery = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

export const idParamsSchema = {
  params: z.object({ id: objectId }),
};

export const listUsersSchema = {
  query: z.object({
    role: z.enum(ROLES as [string, ...string[]]).optional(),
    search: z.string().trim().max(100).optional(),
    ...pageQuery,
  }),
};

export const setUserStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    isActive: z.boolean(),
    // Optional reason when suspending (isActive=false); stored + audited.
    reason: z.string().trim().max(500).optional(),
  }),
};

export const listReviewsSchema = {
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
    ...pageQuery,
  }),
};

// An optional admin note to the user, delivered as an in-app message.
const adminMessage = z.string().trim().max(2000).optional();

export const rejectReviewSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional(), message: adminMessage }),
};

// Shared shape for an approve-style action that may carry an optional admin note.
export const idWithMessageSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ message: adminMessage }).optional(),
};

export const sendMessageSchema = {
  body: z.object({
    recipientId: objectId,
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1, 'متن پیام الزامی است').max(2000),
    relatedType: z.string().trim().max(60).optional(),
  }),
};

export const deleteImageSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ message: adminMessage }).optional(),
};

export const deletePortfolioImageSchema = {
  params: z.object({ id: objectId, imageId: z.string().trim().min(1) }),
  body: z.object({ message: adminMessage }).optional(),
};

export const listSmsLogsSchema = {
  query: z.object({
    event: z.string().trim().max(60).optional(),
    success: z.enum(['true', 'false']).optional(),
    ...pageQuery,
  }),
};

export const listReservationsSchema = {
  query: z.object({
    from: dateStr.optional(),
    to: dateStr.optional(),
    status: z.enum(RESERVATION_STATUSES as [string, ...string[]]).optional(),
    stylistId: objectId.optional(),
    customerId: objectId.optional(),
    salonId: objectId.optional(),
    ...pageQuery,
  }),
};

export const cancelReservationSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional() }),
};

export const listSalonsSchema = {
  query: z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['pending', 'active']).optional(),
    ...pageQuery,
  }),
};

export const listStylistsSchema = {
  query: z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['draft', 'active']).optional(),
    ...pageQuery,
  }),
};

export const promoteSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    until: z.coerce.date().refine((d) => d.getTime() > Date.now(), '`until` must be in the future'),
    tier: z.number().int().min(1).optional(),
  }),
};

export const stylistIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const addPromotionSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    // null/omitted → general promotion; otherwise a category-targeted one.
    categoryId: objectId.nullable().optional(),
    promotedUntil: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'باید در آینده باشد'),
  }),
};

export const removePromotionSchema = {
  params: z.object({ id: objectId, promotionId: objectId }),
};

export const paginationSchema = {
  query: z.object({ ...pageQuery }),
};

export const listVerificationsSchema = {
  query: z.object({
    status: z.enum(['pending', 'verified', 'rejected', 'incomplete']).optional(),
    ...pageQuery,
  }),
};

export const rejectVerificationSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional(), message: adminMessage }),
};

export const listForeignApprovalsSchema = {
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
    ...pageQuery,
  }),
};

export const rejectForeignSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional(), message: adminMessage }),
};

export const stylistDocumentSchema = {
  params: z.object({ id: objectId, side: z.enum(['front', 'back']) }),
};

// ── Service catalogue (categories + services) ──
export const createCategorySchema = {
  body: z.object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().trim().max(80).optional(),
    description: z.string().trim().max(500).optional(),
    order: z.number().int().min(0).max(9999).optional(),
  }),
};

export const updateCategorySchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      slug: z.string().trim().max(80).optional(),
      description: z.string().trim().max(500).optional(),
      order: z.number().int().min(0).max(9999).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const createServiceSchema = {
  body: z.object({
    categoryId: objectId,
    name: z.string().trim().min(1).max(120),
    durationMin: z.number().int().min(1).max(1440),
    defaultPrice: z.number().int().min(0).max(1_000_000_000),
    description: z.string().trim().max(500).optional(),
  }),
};

export const updateServiceSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      categoryId: objectId.optional(),
      name: z.string().trim().min(1).max(120).optional(),
      durationMin: z.number().int().min(1).max(1440).optional(),
      defaultPrice: z.number().int().min(0).max(1_000_000_000).optional(),
      description: z.string().trim().max(500).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

// ── Salon management ──
const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');
const salonGender = z.enum(SERVICE_GENDERS as [string, ...string[]]);
const adminOpeningHours = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    intervals: z.array(z.object({ start: hhmm, end: hhmm })).default([]),
  }),
);

export const adminUpdateSalonSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      address: z.string().trim().min(1).optional(),
      province: z.string().trim().min(1).optional(),
      city: z.string().trim().min(1).optional(),
      serviceGender: salonGender.optional(),
      lng: z.number().min(-180).max(180).optional(),
      lat: z.number().min(-90).max(90).optional(),
      openingHours: adminOpeningHours.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
    .refine(
      (b) => (b.lng === undefined) === (b.lat === undefined),
      'lng and lat must be provided together',
    )
    .refine((b) => (b.province === undefined) === (b.city === undefined), {
      message: 'province and city must be provided together',
      path: ['city'],
    })
    .refine((b) => b.province === undefined || findProvince(b.province) !== undefined, {
      message: 'province is not a valid Iran province',
      path: ['province'],
    })
    .refine((b) => b.province === undefined || isValidProvinceCity(b.province, b.city), {
      message: 'city does not belong to the selected province',
      path: ['city'],
    }),
};

export const setSalonStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(['active', 'pending']) }),
};

export const reservationAnalyticsSchema = {
  query: z.object({
    granularity: z.enum(['week', 'month']).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  }),
};

export const setStylistAcceptingSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ accepting: z.boolean() }),
};

export const setStylistSmsCampaignSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ enabled: z.boolean() }),
};

export const setStylistPlanSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ tier: z.enum(['free', 'silver', 'gold']) }),
};

// ── Wallet manual adjust (signed Toman: + credit / − debit) ──
export const adminWalletAdjustSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    amount: z
      .number()
      .int('مبلغ باید عدد صحیح باشد')
      .refine((v) => v !== 0, 'مبلغ نمی‌تواند صفر باشد')
      .refine((v) => Math.abs(v) <= 500_000_000, 'مبلغ بیش از حد مجاز است'),
    // Optional note stored on the transaction meta + the audit log.
    reason: z.string().trim().max(500).optional(),
  }),
};

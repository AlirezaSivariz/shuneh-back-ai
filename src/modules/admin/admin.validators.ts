import { z } from 'zod';
import { ROLES } from '../../models/User';
import { RESERVATION_STATUSES } from '../../models/Reservation';

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

export const rejectReviewSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional() }),
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
  body: z.object({ reason: z.string().trim().max(500).optional() }),
};

export const listForeignApprovalsSchema = {
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
    ...pageQuery,
  }),
};

export const rejectForeignSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().max(500).optional() }),
};

export const stylistDocumentSchema = {
  params: z.object({ id: objectId, side: z.enum(['front', 'back']) }),
};

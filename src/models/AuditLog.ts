import { Schema, model, Document, Types } from 'mongoose';

/**
 * Immutable record of an admin WRITE action. Every state-changing /admin
 * endpoint appends one of these (see admin.service `audit()`). Read-only after
 * creation — there is intentionally no update/delete path.
 */
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  action: string; // e.g. 'reservation.cancel', 'user.setStatus', 'stylist.promote'
  targetType: string; // e.g. 'reservation', 'user', 'stylist'
  targetId: string;
  /** Small summary of the change (never secrets). */
  summary?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true, index: true },
    summary: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);

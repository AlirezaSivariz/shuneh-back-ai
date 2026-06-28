import { Schema, model, Document, Types } from 'mongoose';

export type ReportTargetType = 'post' | 'comment';
export type ReportStatus = 'open' | 'reviewed';

/** A user-submitted abuse report against a post or comment. */
export interface IContentReport extends Document {
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  reporterId: Types.ObjectId;
  reason: string;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

const contentReportSchema = new Schema<IContentReport>(
  {
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['open', 'reviewed'], default: 'open', index: true },
  },
  { timestamps: true },
);

// One report per (reporter, target) — prevents spam-reporting the same item.
contentReportSchema.index({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true });
contentReportSchema.index({ status: 1, createdAt: -1 });

export const ContentReport = model<IContentReport>('ContentReport', contentReportSchema);

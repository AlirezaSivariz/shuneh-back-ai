import { Schema, model, Document, Types } from 'mongoose';

/**
 * One-way in-app message from support (admin) to a user. The user can read it
 * but not reply — it is purely a notification/communication channel inside the
 * panel (replaces approval/rejection SMS for review/foreign/verification).
 */
export interface IMessage extends Document {
  _id: Types.ObjectId;
  recipientId: Types.ObjectId;
  title?: string | null;
  body: string;
  isRead: boolean;
  /** Optional context, e.g. 'review_rejected' | 'image_removed' | 'foreign_rejected'. */
  relatedType?: string | null;
  createdBy: Types.ObjectId; // the admin who sent it
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: null },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    isRead: { type: Boolean, default: false, index: true },
    relatedType: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

messageSchema.index({ recipientId: 1, createdAt: -1 });

export const Message = model<IMessage>('Message', messageSchema);

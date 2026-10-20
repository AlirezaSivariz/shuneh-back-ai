import { Schema, model, Document, Types } from 'mongoose';

/**
 * A 1:1 chat thread between a customer and a stylist.
 *
 * `stylistUserId` and `customerId` are both User ids (the public stylist `id`
 * is the stylist's userId). A unique compound index guarantees a single thread
 * per pair; unread counters are kept per side so each participant can badge
 * their inbox independently.
 */
export interface IChatConversation extends Document {
  customerId: Types.ObjectId;
  stylistUserId: Types.ObjectId;
  lastMessageText: string;
  lastMessageSenderId: Types.ObjectId | null;
  lastMessageAt: Date | null;
  /** When the stylist sent their first reply (null until then). Used so the
   * customer is SMS-notified exactly once per thread. */
  stylistRepliedAt: Date | null;
  customerUnread: number;
  stylistUnread: number;
  createdAt: Date;
  updatedAt: Date;
}

const chatConversationSchema = new Schema<IChatConversation>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stylistUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastMessageText: { type: String, default: '', maxlength: 500 },
    lastMessageSenderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastMessageAt: { type: Date, default: null },
    stylistRepliedAt: { type: Date, default: null },
    customerUnread: { type: Number, default: 0, min: 0 },
    stylistUnread: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

chatConversationSchema.index({ customerId: 1, stylistUserId: 1 }, { unique: true });

export const ChatConversation = model<IChatConversation>(
  'ChatConversation',
  chatConversationSchema,
);

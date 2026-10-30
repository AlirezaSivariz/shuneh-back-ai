import { Schema, model, Document, Types } from 'mongoose';

export type ChatMessageType = 'text' | 'image';

export interface IChatMessage extends Document {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  type: ChatMessageType;
  text?: string;
  imageKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['text', 'image'], default: 'text' },
    text: { type: String, trim: true, maxlength: 2000 },
    imageKey: { type: String },
  },
  { timestamps: true },
);

// Paged / incremental reads are always scoped to one thread and ordered by time.
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema);

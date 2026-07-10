import { Schema, model, Document, Types } from 'mongoose';

export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'closed';
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'answered', 'closed'];

export type TicketPriority = 'low' | 'medium' | 'high';
export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high'];

export interface ITicketMessage {
  senderId: Types.ObjectId;
  senderRole: 'customer' | 'stylist' | 'admin';
  text: string;
  attachments: { url: string; name: string }[];
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'customer' | 'stylist' | 'owner';
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  messages: ITicketMessage[];
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<ITicketMessage>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['customer', 'stylist', 'admin'], required: true },
    text: { type: String, required: true },
    attachments: { type: [{ url: String, name: String }], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['customer', 'stylist', 'owner'], required: true },
    subject: { type: String, required: true, maxlength: 200 },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'medium' },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    messages: { type: [messageSchema], default: [] },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

supportTicketSchema.index({ userId: 1, status: 1 });

export const SupportTicket = model<ISupportTicket>('SupportTicket', supportTicketSchema);

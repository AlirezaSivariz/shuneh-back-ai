import { Types } from 'mongoose';
import { Message, IMessage } from '../../models/Message';
import { AppError } from '../../utils/AppError';

/**
 * Quick-pick templates for admins (choose one or write a custom message). Defined
 * server-side so the wording stays consistent and translatable in one place.
 */
export const MESSAGE_TEMPLATES: Array<{ key: string; title: string; body: string }> = [
  {
    key: 'image_inappropriate',
    title: 'عکس نامناسب',
    body: 'عکس پروفایلت مناسب نبود و حذف شد. لطفاً یک عکس مناسب جایگزین کن.',
  },
  {
    key: 'portfolio_inappropriate',
    title: 'نمونه‌کار نامناسب',
    body: 'یکی از نمونه‌کارهایت مناسب نبود و حذف شد. لطفاً نمونه‌کار مناسب اضافه کن.',
  },
  { key: 'review_rejected', title: 'نظر تأیید نشد', body: 'نظر شما تأیید نشد و نمایش داده نمی‌شود.' },
  { key: 'request_rejected', title: 'درخواست رد شد', body: 'درخواست شما رد شد.' },
  { key: 'documents_incomplete', title: 'مدارک ناقص', body: 'مدارک ارسالی شما ناقص است؛ لطفاً آن‌ها را کامل کن.' },
  { key: 'verification_rejected', title: 'تأیید پروفایل', body: 'درخواست تأیید پروفایل شما رد شد.' },
];

function serialize(m: IMessage) {
  return {
    id: String(m._id),
    title: m.title ?? null,
    body: m.body,
    isRead: m.isRead,
    relatedType: m.relatedType ?? null,
    createdAt: m.createdAt,
  };
}

/** Create a message for a user (best-effort callers may ignore the result). */
export async function createMessage(input: {
  recipientId: string;
  body: string;
  title?: string;
  relatedType?: string;
  createdBy: string;
}): Promise<IMessage> {
  if (!Types.ObjectId.isValid(input.recipientId)) {
    throw AppError.badRequest('شناسه‌ی کاربر نامعتبر است', 'INVALID_ID');
  }
  return Message.create({
    recipientId: new Types.ObjectId(input.recipientId),
    body: input.body,
    title: input.title ?? null,
    relatedType: input.relatedType ?? null,
    createdBy: new Types.ObjectId(input.createdBy),
  });
}

/** A user's own messages (newest first) + the unread count. */
export async function listForUser(userId: string) {
  const [rows, unreadCount] = await Promise.all([
    Message.find({ recipientId: userId }).sort({ createdAt: -1 }).limit(100),
    Message.countDocuments({ recipientId: userId, isRead: false }),
  ]);
  return { items: rows.map(serialize), unreadCount };
}

export async function unreadCount(userId: string): Promise<number> {
  return Message.countDocuments({ recipientId: userId, isRead: false });
}

/** Mark one of the user's OWN messages as read (ownership enforced). */
export async function markRead(userId: string, messageId: string) {
  if (!Types.ObjectId.isValid(messageId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const message = await Message.findOne({ _id: messageId, recipientId: userId });
  if (!message) throw AppError.notFound('پیام یافت نشد', 'MESSAGE_NOT_FOUND');
  if (!message.isRead) {
    message.isRead = true;
    await message.save();
  }
  return serialize(message);
}

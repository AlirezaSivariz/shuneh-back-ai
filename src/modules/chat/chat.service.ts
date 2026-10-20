import { Types } from 'mongoose';
import { ChatConversation } from '../../models/ChatConversation';
import { ChatMessage } from '../../models/ChatMessage';
import { StylistProfile } from '../../models/StylistProfile';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';

interface ChatPeerResponse {
  id: string;
  fullName: string;
  profilePhoto: string | null;
  username: string | null;
  isStylist: boolean;
}

interface ChatMessageResponse {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  isMine: boolean;
}

interface ChatConversationResponse {
  id: string;
  customerId: string;
  stylistId: string;
  peer: ChatPeerResponse | null;
  lastMessage: {
    text: string;
    senderId: string | null;
    createdAt: string;
    isMine: boolean;
  } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return new Date(value as string | Date).toISOString();
}

async function buildPeer(userId: string, isStylist: boolean): Promise<ChatPeerResponse | null> {
  const user = await User.findById(userId).select('firstName lastName profilePhoto').lean();
  if (!user) return null;

  let username: string | null = null;
  if (isStylist) {
    const profile = await StylistProfile.findOne({ userId }).select('username').lean();
    username = profile?.username ?? null;
  }

  return {
    id: String(user._id),
    fullName:
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      (isStylist ? 'متخصص شونه' : 'کاربر شونه'),
    profilePhoto: user.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
    username,
    isStylist,
  };
}

function toConversationResponse(
  conv: Record<string, any>,
  viewerId: string,
  peer: ChatPeerResponse | null,
): ChatConversationResponse {
  const isCustomer = String(conv.customerId) === viewerId;
  const senderId = conv.lastMessageSenderId ? String(conv.lastMessageSenderId) : null;

  return {
    id: String(conv._id),
    customerId: String(conv.customerId),
    stylistId: String(conv.stylistUserId),
    peer,
    lastMessage: conv.lastMessageAt
      ? {
          text: conv.lastMessageText ?? '',
          senderId,
          createdAt: iso(conv.lastMessageAt)!,
          isMine: senderId === viewerId,
        }
      : null,
    unreadCount: (isCustomer ? conv.customerUnread : conv.stylistUnread) ?? 0,
    createdAt: iso(conv.createdAt)!,
    updatedAt: iso(conv.updatedAt ?? conv.createdAt)!,
  };
}

function assertParticipant(conv: Record<string, any>, userId: string): void {
  const isCustomer = String(conv.customerId) === userId;
  const isStylist = String(conv.stylistUserId) === userId;
  if (!isCustomer && !isStylist) {
    throw AppError.forbidden('شما به این گفتگو دسترسی ندارید', 'CHAT_FORBIDDEN');
  }
}

async function findConversationOrThrow(conversationId: string): Promise<Record<string, any>> {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw AppError.notFound('گفتگو یافت نشد', 'CHAT_NOT_FOUND');
  }
  const conv = await ChatConversation.findById(conversationId).lean();
  if (!conv) throw AppError.notFound('گفتگو یافت نشد', 'CHAT_NOT_FOUND');
  return conv as unknown as Record<string, any>;
}

async function resolvePeerForViewer(
  conv: Record<string, any>,
  viewerId: string,
): Promise<ChatPeerResponse | null> {
  const isCustomer = String(conv.customerId) === viewerId;
  return buildPeer(
    isCustomer ? String(conv.stylistUserId) : String(conv.customerId),
    !isCustomer,
  );
}

/** Open (or reuse) the thread between the current customer and a stylist. */
export async function getOrCreateConversation(
  customerId: string,
  stylistId: string,
): Promise<ChatConversationResponse> {
  if (customerId === stylistId) {
    throw AppError.badRequest('نمی‌توانید با خودتان گفتگو کنید', 'CHAT_SELF');
  }
  if (!Types.ObjectId.isValid(stylistId)) {
    throw AppError.badRequest('شناسه متخصص نامعتبر است', 'INVALID_ID');
  }

  const stylist = await StylistProfile.findOne({ userId: stylistId }).select('userId status').lean();
  if (!stylist) {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }

  let conv: Record<string, any> | null = null;
  try {
    conv = (await ChatConversation.findOneAndUpdate(
      { customerId, stylistUserId: stylistId },
      { $setOnInsert: { customerId, stylistUserId: stylistId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()) as unknown as Record<string, any>;
  } catch (err: any) {
    // Concurrent first messages can race the unique index; fall back to read.
    if (err?.code !== 11000) throw err;
    conv = (await ChatConversation.findOne({
      customerId,
      stylistUserId: stylistId,
    }).lean()) as unknown as Record<string, any>;
  }

  if (!conv) throw AppError.notFound('گفتگو یافت نشد', 'CHAT_NOT_FOUND');
  const peer = await buildPeer(stylistId, true);
  return toConversationResponse(conv, customerId, peer);
}

export async function listConversations(userId: string): Promise<ChatConversationResponse[]> {
  const raw = (await ChatConversation.find({
    $or: [{ customerId: userId }, { stylistUserId: userId }],
  })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean()) as unknown as Record<string, any>[];

  if (raw.length === 0) return [];

  const userIds = new Set<string>();
  const stylistIds = new Set<string>();
  for (const conv of raw) {
    userIds.add(String(conv.customerId));
    userIds.add(String(conv.stylistUserId));
    stylistIds.add(String(conv.stylistUserId));
  }

  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('firstName lastName profilePhoto')
      .lean(),
    StylistProfile.find({ userId: { $in: [...stylistIds] } })
      .select('userId username')
      .lean(),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const usernameMap = new Map(profiles.map((p) => [String(p.userId), p.username ?? null]));

  const peerOf = (peerId: string, isStylist: boolean): ChatPeerResponse | null => {
    const user = userMap.get(peerId);
    if (!user) return null;
    return {
      id: String(user._id),
      fullName:
        `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
        (isStylist ? 'متخصص شونه' : 'کاربر شونه'),
      profilePhoto: user.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
      username: isStylist ? (usernameMap.get(peerId) ?? null) : null,
      isStylist,
    };
  };

  return raw.map((conv) => {
    const isCustomer = String(conv.customerId) === userId;
    const peer = peerOf(
      isCustomer ? String(conv.stylistUserId) : String(conv.customerId),
      !isCustomer,
    );
    return toConversationResponse(conv, userId, peer);
  });
}

export async function listMessages(
  userId: string,
  conversationId: string,
  options: { after?: string; limit?: number },
): Promise<{
  items: ChatMessageResponse[];
  conversation: ChatConversationResponse;
}> {
  const conv = await findConversationOrThrow(conversationId);
  assertParticipant(conv, userId);

  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const filter: Record<string, any> = { conversationId };

  if (options.after) {
    const after = new Date(options.after);
    if (Number.isNaN(after.getTime())) {
      throw AppError.badRequest('زمان پیام نامعتبر است', 'INVALID_CURSOR');
    }
    filter.createdAt = { $gt: after };
  }

  let raw: Record<string, any>[];
  if (options.after) {
    raw = (await ChatMessage.find(filter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()) as unknown as Record<string, any>[];
  } else {
    raw = (await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()) as unknown as Record<string, any>[];
    raw.reverse();
  }

  // Opening the thread (initial load or poll) implies the viewer read it.
  const isCustomer = String(conv.customerId) === userId;
  const unreadField = isCustomer ? 'customerUnread' : 'stylistUnread';
  if (conv[unreadField] > 0) {
    await ChatConversation.updateOne({ _id: conv._id }, { $set: { [unreadField]: 0 } });
    conv[unreadField] = 0;
  }

  const peer = await resolvePeerForViewer(conv, userId);

  return {
    items: raw.map((m) => ({
      id: String(m._id),
      conversationId,
      senderId: String(m.senderId),
      text: m.text,
      createdAt: iso(m.createdAt)!,
      isMine: String(m.senderId) === userId,
    })),
    conversation: toConversationResponse(conv, userId, peer),
  };
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  text: string,
): Promise<ChatMessageResponse> {
  const conv = await findConversationOrThrow(conversationId);
  assertParticipant(conv, userId);

  const message = await ChatMessage.create({
    conversationId: conv._id,
    senderId: userId,
    text,
  });

  const isCustomer = String(conv.customerId) === userId;
  const update: Record<string, any> = {
    lastMessageText: text.slice(0, 200),
    lastMessageSenderId: new Types.ObjectId(userId),
    lastMessageAt: message.createdAt,
  };

  await ChatConversation.updateOne(
    { _id: conv._id },
    {
      $set: update,
      $inc: { [isCustomer ? 'stylistUnread' : 'customerUnread']: 1 },
    },
  );

  return {
    id: String(message._id),
    conversationId,
    senderId: userId,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
    isMine: true,
  };
}

export async function markRead(userId: string, conversationId: string): Promise<{ unreadCount: number }> {
  const conv = await findConversationOrThrow(conversationId);
  assertParticipant(conv, userId);

  const isCustomer = String(conv.customerId) === userId;
  await ChatConversation.updateOne(
    { _id: conv._id },
    { $set: { [isCustomer ? 'customerUnread' : 'stylistUnread']: 0 } },
  );
  return { unreadCount: 0 };
}

export async function getUnreadCount(userId: string): Promise<{ count: number }> {
  const uid = new Types.ObjectId(userId);
  const [customerAgg, stylistAgg] = await Promise.all([
    ChatConversation.aggregate([
      { $match: { customerId: uid } },
      { $group: { _id: null, total: { $sum: '$customerUnread' } } },
    ]),
    ChatConversation.aggregate([
      { $match: { stylistUserId: uid } },
      { $group: { _id: null, total: { $sum: '$stylistUnread' } } },
    ]),
  ]);

  const count = (customerAgg[0]?.total ?? 0) + (stylistAgg[0]?.total ?? 0);
  return { count };
}

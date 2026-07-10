import { Types } from 'mongoose';
import { SupportTicket, TicketStatus, TicketPriority } from '../../models/SupportTicket';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';

interface ListQuery {
  page?: number;
  limit?: number;
  status?: string;
  role?: string;
}

interface CreateTicketInput {
  subject: string;
  priority: TicketPriority;
  message: string;
}

interface AddMessageInput {
  text: string;
  attachments?: { url: string; name: string }[];
}

interface TicketMessageResponse {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  text: string;
  attachments: { url: string; name: string }[];
  createdAt: string;
}

interface TicketResponse {
  id: string;
  userId: string;
  role: string;
  subject: string;
  priority: string;
  status: string;
  messages: TicketMessageResponse[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; fullName: string | null; phone: string } | null;
}

function toTicketResponse(ticket: Record<string, any>, includeUser = false): TicketResponse {
  const msgs = (ticket.messages ?? []) as Record<string, any>[];
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;

  const res: TicketResponse = {
    id: String(ticket._id),
    userId: String(ticket.userId),
    role: ticket.role,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    messages: msgs.map((m) => ({
      id: String(m._id),
      senderId: String(m.senderId),
      senderName: '',
      senderRole: m.senderRole,
      text: m.text,
      attachments: m.attachments ?? [],
      createdAt: m.createdAt?.toISOString?.() ?? new Date().toISOString(),
    })),
    lastMessage: lastMsg?.text ?? null,
    lastMessageAt: lastMsg?.createdAt?.toISOString?.() ?? null,
    createdAt: ticket.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: ticket.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };

  if (includeUser && ticket.userId) {
    res.user = {
      id: String(ticket.userId),
      fullName: null,
      phone: '',
    };
  }

  return res;
}

export async function createTicket(
  userId: string,
  role: 'customer' | 'stylist' | 'owner',
  input: CreateTicketInput,
): Promise<TicketResponse> {
  const ticket = await SupportTicket.create({
    userId: new Types.ObjectId(userId),
    role,
    subject: input.subject,
    priority: input.priority,
    messages: [
      {
        senderId: new Types.ObjectId(userId),
        senderRole: role === 'owner' ? 'customer' : role,
        text: input.message,
        attachments: [],
        createdAt: new Date(),
      },
    ],
  });

  return toTicketResponse(ticket.toObject());
}

export async function listMyTickets(
  userId: string,
  query: ListQuery,
): Promise<{ items: TicketResponse[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const filter: Record<string, any> = { userId };

  if (query.status && ['open', 'in_progress', 'answered', 'closed'].includes(query.status)) {
    filter.status = query.status;
  }

  const [raw, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  const items = raw.map((t) => toTicketResponse(t));
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getMyTicket(userId: string, ticketId: string): Promise<TicketResponse> {
  const ticket = await SupportTicket.findOne({ _id: ticketId, userId }).lean();
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');
  return toTicketResponse(ticket);
}

export async function addMessage(
  userId: string,
  ticketId: string,
  input: AddMessageInput,
): Promise<TicketMessageResponse> {
  const ticket = await SupportTicket.findOne({ _id: ticketId, userId });
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');
  if (ticket.status === 'closed') throw AppError.badRequest('این تیکت بسته شده است');

  const msg = {
    senderId: new Types.ObjectId(userId),
    senderRole: ticket.role === 'owner' ? 'customer' as const : ticket.role as 'customer' | 'stylist',
    text: input.text,
    attachments: input.attachments ?? [],
    createdAt: new Date(),
  };

  ticket.messages.push(msg as any);
  ticket.status = 'open';
  await ticket.save();

  const lastMsg = ticket.messages[ticket.messages.length - 1] as any;
  return {
    id: String(lastMsg._id),
    senderId: String(userId),
    senderName: '',
    senderRole: msg.senderRole,
    text: input.text,
    attachments: input.attachments ?? [],
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function listAllTickets(
  query: ListQuery & { role?: string },
): Promise<{ items: TicketResponse[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const filter: Record<string, any> = {};

  if (query.status && ['open', 'in_progress', 'answered', 'closed'].includes(query.status)) {
    filter.status = query.status;
  }
  if (query.role && ['customer', 'stylist', 'owner'].includes(query.role)) {
    filter.role = query.role;
  }

  const [raw, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  const userIds = [...new Set(raw.map((t) => String(t.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('firstName lastName phone')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const items = raw.map((t) => {
    const r = toTicketResponse(t, true);
    const u = userMap.get(String(t.userId));
    if (u) {
      r.user = {
        id: String(u._id),
        fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null,
        phone: u.phone,
      };
    }
    return r;
  });

  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getTicketDetail(ticketId: string): Promise<TicketResponse> {
  const ticket = await SupportTicket.findById(ticketId).lean();
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');

  const r = toTicketResponse(ticket, true);
  const u = await User.findById(ticket.userId).select('firstName lastName phone').lean();
  if (u) {
    r.user = {
      id: String(u._id),
      fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null,
      phone: u.phone,
    };
  }

  return r;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<TicketResponse> {
  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { $set: { status } },
    { new: true },
  ).lean();
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');
  return toTicketResponse(ticket, true);
}

export async function closeTicket(
  ticketId: string,
  adminId: string,
): Promise<TicketResponse> {
  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { $set: { status: 'closed', closedAt: new Date(), closedBy: new Types.ObjectId(adminId) } },
    { new: true },
  ).lean();
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');
  return toTicketResponse(ticket, true);
}

export async function adminAddMessage(
  adminId: string,
  ticketId: string,
  input: AddMessageInput,
): Promise<TicketMessageResponse> {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw AppError.notFound('تیکت یافت نشد');
  if (ticket.status === 'closed') throw AppError.badRequest('این تیکت بسته شده است');

  const msg = {
    senderId: new Types.ObjectId(adminId),
    senderRole: 'admin' as const,
    text: input.text,
    attachments: input.attachments ?? [],
    createdAt: new Date(),
  };

  ticket.messages.push(msg as any);
  ticket.status = 'answered';
  await ticket.save();

  const lastMsg = ticket.messages[ticket.messages.length - 1] as any;
  return {
    id: String(lastMsg._id),
    senderId: String(adminId),
    senderName: '',
    senderRole: 'admin',
    text: input.text,
    attachments: input.attachments ?? [],
    createdAt: msg.createdAt.toISOString(),
  };
}

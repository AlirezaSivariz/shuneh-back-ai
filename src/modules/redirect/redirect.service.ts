import { Types } from 'mongoose';
import { Redirect } from '../../models/Redirect';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';

/** How many chained redirects we are willing to follow / flatten. */
const MAX_CHAIN = 5;

/** Best-effort audit trail entry (never breaks the action itself). */
async function audit(
  adminId: string,
  action: string,
  targetId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(adminId),
      action,
      targetType: 'redirect',
      targetId,
      summary,
    });
  } catch {
    /* auditing must not break the action */
  }
}

/**
 * Canonical form of a site path: leading slash, no query/hash, no duplicate or
 * trailing slash, lowercase (Next routes are lowercase; stylist usernames and
 * blog slugs are lowercase by construction).
 */
export function normalizePath(raw: string): string {
  let p = (raw ?? '').trim().split('#')[0].split('?')[0];
  if (!p) return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/').toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function view(r: {
  _id: unknown;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isAuto?: boolean;
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(r._id),
    fromPath: r.fromPath,
    toPath: r.toPath,
    statusCode: r.statusCode as 301 | 302,
    isAuto: r.isAuto === true,
    note: r.note ?? '',
    createdAt: r.createdAt?.toISOString?.() ?? '',
    updatedAt: r.updatedAt?.toISOString?.() ?? '',
  };
}

/**
 * Reject a link that would close a loop (A→B while B→…→A) or a chain so long
 * it is almost certainly a mistake. `ignoreFrom` skips the edge of the row
 * being edited (it is about to be replaced, so it must not count as a loop).
 */
async function assertNoCycle(fromPath: string, toPath: string, ignoreFrom?: string): Promise<void> {
  if (fromPath === toPath) {
    throw AppError.badRequest('آدرس مبدأ و مقصد نمی‌توانند یکسان باشند', 'SAME_PATH');
  }
  const seen = new Set<string>([fromPath]);
  let cursor = toPath;
  for (let hops = 0; hops <= MAX_CHAIN; hops++) {
    if (cursor === ignoreFrom) return; // the edited row's old edge is being replaced
    if (seen.has(cursor)) {
      throw AppError.badRequest('این ریدایرکت یک حلقه ایجاد می‌کند', 'REDIRECT_CYCLE');
    }
    seen.add(cursor);
    const next = await Redirect.findOne({ fromPath: cursor }).select('toPath').lean();
    if (!next) return; // chain ends on a real (non-redirected) path
    cursor = next.toPath;
  }
  throw AppError.badRequest('زنجیرهٔ ریدایرکت‌ها بیش از حد طولانی است', 'REDIRECT_CHAIN_TOO_LONG');
}

export async function listRedirects(query: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<{ items: ReturnType<typeof view>[]; total: number; page: number; totalPages: number; limit: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const filter: Record<string, unknown> = {};
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
    filter.$or = [{ fromPath: rx }, { toPath: rx }, { note: rx }];
  }

  const [rows, total] = await Promise.all([
    Redirect.find(filter)
      .sort({ isAuto: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Redirect.countDocuments(filter),
  ]);

  return {
    items: rows.map(view),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function createRedirect(
  adminId: string,
  input: { fromPath: string; toPath: string; statusCode?: 301 | 302; note?: string },
) {
  const fromPath = normalizePath(input.fromPath);
  const toPath = normalizePath(input.toPath);
  if (fromPath === '/') {
    throw AppError.badRequest('آدرس صفحهٔ اصلی را نمی‌توان ریدایرکت کرد', 'ROOT_REDIRECT');
  }
  await assertNoCycle(fromPath, toPath);

  const exists = await Redirect.exists({ fromPath });
  if (exists) {
    throw AppError.conflict('برای این مسیر قبلاً ریدایرکت ثبت شده است', 'REDIRECT_EXISTS');
  }

  const created = await Redirect.create({
    fromPath,
    toPath,
    statusCode: input.statusCode ?? 301,
    note: input.note ?? '',
    isAuto: false,
    createdBy: Types.ObjectId.isValid(adminId) ? new Types.ObjectId(adminId) : null,
  });
  await audit(adminId, 'redirect.create', String(created._id), { fromPath, toPath });
  return view(created.toObject());
}

export async function updateRedirect(
  adminId: string,
  id: string,
  input: { toPath?: string; statusCode?: 301 | 302; note?: string },
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسهٔ نامعتبر', 'INVALID_ID');
  const row = await Redirect.findById(id);
  if (!row) throw AppError.notFound('ریدایرکت یافت نشد', 'REDIRECT_NOT_FOUND');

  if (input.toPath !== undefined) {
    const toPath = normalizePath(input.toPath);
    await assertNoCycle(row.fromPath, toPath, row.fromPath);
    row.toPath = toPath;
  }
  if (input.statusCode !== undefined) row.statusCode = input.statusCode;
  if (input.note !== undefined) row.note = input.note;
  await row.save();
  await audit(adminId, 'redirect.update', id, {
    fromPath: row.fromPath,
    toPath: row.toPath,
    statusCode: row.statusCode,
  });
  return view(row.toObject());
}

export async function deleteRedirect(adminId: string, id: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسهٔ نامعتبر', 'INVALID_ID');
  const deleted = await Redirect.findByIdAndDelete(id);
  if (!deleted) throw AppError.notFound('ریدایرکت یافت نشد', 'REDIRECT_NOT_FOUND');
  await audit(adminId, 'redirect.delete', id, { fromPath: deleted.fromPath, toPath: deleted.toPath });
}

/**
 * Public map consumed by the site's edge middleware: every entry with its
 * chain flattened, so the browser (and Google) always gets a single hop — and
 * a real 301/302 response. Loops or over-long chains are omitted rather than
 * risking an infinite redirect.
 */
export async function getRedirectMap(): Promise<{
  items: { from: string; to: string; statusCode: 301 | 302 }[];
}> {
  const rows = await Redirect.find().select('fromPath toPath statusCode').lean();
  const byFrom = new Map(rows.map((r) => [r.fromPath, r]));
  const items: { from: string; to: string; statusCode: 301 | 302 }[] = [];

  for (const row of rows) {
    const seen = new Set<string>([row.fromPath]);
    let target = row.toPath;
    let cursor = row.toPath;
    let valid = true;
    for (let hops = 0; hops < MAX_CHAIN; hops++) {
      const next = byFrom.get(cursor);
      if (!next) break;
      if (seen.has(next.fromPath)) {
        valid = false;
        break;
      }
      seen.add(next.fromPath);
      target = next.toPath;
      cursor = next.toPath;
    }
    // Still chained after MAX_CHAIN hops → treat as invalid, don't serve it.
    if (valid && byFrom.get(cursor)) valid = false;
    if (!valid || target === row.fromPath) continue;
    items.push({ from: row.fromPath, to: target, statusCode: row.statusCode });
  }

  return { items };
}

/**
 * Record the redirect for a path that no longer exists (used by the system when
 * a page's URL changes). Idempotent; also re-points older redirects that used
 * to land on the old path and drops a stale redirect that would shadow the new
 * live path.
 */
export async function registerAutoRedirect(fromPath: string, toPath: string, note = ''): Promise<void> {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (!from || !to || from === '/' || from === to) return;

  const existing = await Redirect.findOne({ fromPath: from }).select('toPath').lean();
  if (existing && existing.toPath === to) return;

  // The new URL is live again; a redirect on it would hide the real page.
  await Redirect.deleteOne({ fromPath: to });
  // Flatten: anything that used to point at the old URL now points at the new one.
  await Redirect.updateMany({ toPath: from }, { $set: { toPath: to } });
  await Redirect.updateOne(
    { fromPath: from },
    { $set: { toPath: to, statusCode: 301, isAuto: true, note } },
    { upsert: true },
  );
}

/**
 * Called whenever a stylist's public slug (username) changes: the previous
 * profile URL becomes a permanent redirect to the new one.
 */
export async function registerStylistUsernameChange(
  oldUsername: string | null | undefined,
  newUsername: string | null | undefined,
): Promise<void> {
  const oldSlug = (oldUsername ?? '').trim().toLowerCase();
  const newSlug = (newUsername ?? '').trim().toLowerCase();
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  await registerAutoRedirect(
    `/stylists/${oldSlug}`,
    `/stylists/${newSlug}`,
    `تغییر نام کاربری متخصص: ${oldSlug} → ${newSlug}`,
  );
}

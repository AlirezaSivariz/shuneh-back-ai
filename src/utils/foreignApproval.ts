/**
 * Central rule for the foreign-national approval gate. A user who declared
 * themselves a foreign national is RESTRICTED until an admin approves them:
 * a restricted customer can't book, a restricted stylist isn't bookable/listed,
 * and a restricted owner's salons aren't shown. Iranian users and approved
 * foreign users are never restricted.
 *
 * Keep this the single source of truth so every gate (reservations, search,
 * bookability, salon visibility) behaves identically.
 */
export interface ForeignFields {
  isForeignNational?: boolean | null;
  foreignApprovalStatus?: string | null;
}

/** True when this user is a foreign national who has NOT been approved yet. */
export function isForeignRestricted(user: ForeignFields | null | undefined): boolean {
  return (
    !!user &&
    user.isForeignNational === true &&
    user.foreignApprovalStatus !== 'approved'
  );
}

/** Why an account is not fully active. Drives the client's "panel disabled" UI. */
export type InactiveReason =
  | 'account_disabled' // admin-blocked (isActive=false)
  | 'awaiting_documents' // foreign national who hasn't uploaded their passport yet
  | 'pending_foreign_approval' // foreign national awaiting admin review
  | 'foreign_rejected'; // foreign national whose review was declined

export interface AccountStatusFields extends ForeignFields {
  isActive?: boolean | null;
}

/**
 * THE single source of "is this account active?". Combines the admin-disable
 * flag with the foreign-approval gate so callers never re-derive it. An active
 * account is one that is not admin-blocked AND (Iranian OR an approved foreign
 * national).
 */
export function accountStatus(
  user: AccountStatusFields | null | undefined,
): { active: boolean; reason: InactiveReason | null } {
  if (!user) return { active: false, reason: 'account_disabled' };
  if (user.isActive === false) return { active: false, reason: 'account_disabled' };
  if (user.isForeignNational === true) {
    if (user.foreignApprovalStatus === 'awaiting_documents') {
      return { active: false, reason: 'awaiting_documents' };
    }
    if (user.foreignApprovalStatus === 'pending') {
      return { active: false, reason: 'pending_foreign_approval' };
    }
    if (user.foreignApprovalStatus === 'rejected') {
      return { active: false, reason: 'foreign_rejected' };
    }
  }
  return { active: true, reason: null };
}

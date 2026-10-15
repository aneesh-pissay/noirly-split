import { ApiError } from "@/src/server/api/http";

/**
 * Everyone an expense names must be in the group: whoever paid, everyone it is
 * split between, and everyone in an uneven split's allocations (those, not the
 * participant list, decide who owes what). Otherwise a member could put debt
 * on an outsider, or on someone who has left and can no longer settle it.
 */
export function assertExpensePeople(
  memberIds: ReadonlySet<string>,
  expense: {
    payers?: Array<{ userId: string }>;
    paidByUserId?: string;
    participantIds: string[];
    splitMethod: string;
    allocations?: Array<{ userId: string }>;
  },
) {
  const payers = expense.payers ?? (expense.paidByUserId ? [{ userId: expense.paidByUserId }] : []);
  const fail = (message: string) => {
    throw new ApiError(400, "invalid_request", message);
  };
  if (payers.some((p) => !memberIds.has(p.userId))) fail("Payer must be a member");
  if (expense.participantIds.some((id) => !memberIds.has(id))) fail("All participants must be members");
  if (new Set(expense.participantIds).size !== expense.participantIds.length) fail("Each participant can appear once");

  if (expense.splitMethod !== "equal") {
    const allocated = (expense.allocations ?? []).map((a) => a.userId);
    const participants = new Set(expense.participantIds);
    if (new Set(allocated).size !== allocated.length) fail("Each person can appear once in the split");
    if (allocated.some((id) => !participants.has(id))) fail("Split amounts must be for participants");
    if (allocated.length !== participants.size) fail("Every participant needs a share");
  }
}

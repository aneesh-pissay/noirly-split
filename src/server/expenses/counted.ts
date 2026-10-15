import { Types } from "mongoose";

/**
 * Expenses that count toward money owed: live, and not a recurring template.
 * A recurring expense is stored as a template plus one row per occurrence;
 * the template only schedules them, so counting it too would double the debt.
 */
export function countedExpensesFilter(groupId: string | Types.ObjectId) {
  return {
    groupId: typeof groupId === "string" ? new Types.ObjectId(groupId) : groupId,
    deletedAt: null,
    isRecurring: { $ne: true },
  };
}

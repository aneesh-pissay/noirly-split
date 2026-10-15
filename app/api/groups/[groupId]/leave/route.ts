import { Types } from "mongoose";
import {
  ApiError,
  assertObjectId,
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { requireGroupMembership } from "@/src/server/groups/access";
import { computeNets } from "@/src/core/balances/net";
import { formatMoney } from "@/src/core/money";
import { countedExpensesFilter } from "@/src/server/expenses/counted";
import { mapExpense, mapSettlement } from "@/src/server/mappers";
import { Expense, GroupMember, Settlement } from "@/src/server/models";

type Params = { params: Promise<{ groupId: string }> };

/** Leave the group (self). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");

    await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);
      const count = await GroupMember.countDocuments({
        groupId: new Types.ObjectId(groupId),
      });
      if (group.createdBy.toString() === ctx.userId && count > 1) {
        throw new ApiError(
          400,
          "invalid_request",
          "Creator must archive or delete before leaving while others remain",
        );
      }
      // Only once settled: a former member can't record payments, so a debt
      // they left behind could never be cleared.
      const [expenses, settlements] = await Promise.all([
        Expense.find(countedExpensesFilter(groupId)).lean(),
        Settlement.find({ groupId: new Types.ObjectId(groupId) }).lean(),
      ]);
      const mine = computeNets({
        memberIds: [ctx.userId],
        expenses: expenses.map((doc) => mapExpense(doc as typeof doc & { createdAt: Date; updatedAt: Date })),
        settlements: settlements.map((doc) => mapSettlement(doc as typeof doc & { createdAt: Date; settledAt: Date })),
      }).find((net) => net.userId === ctx.userId)?.netInBase ?? 0;
      if (mine !== 0) {
        const amount = formatMoney(Math.abs(mine), group.baseCurrency);
        throw new ApiError(
          409,
          "unsettled_balance",
          mine < 0
            ? `Settle up before leaving: you still owe ${amount}.`
            : `Settle up before leaving: you are still owed ${amount}.`,
        );
      }

      await GroupMember.deleteOne({
        groupId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(ctx.userId),
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

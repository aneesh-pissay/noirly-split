import { countedExpensesFilter } from "@/src/server/expenses/counted";
import { Types } from "mongoose";
import { computeNets } from "@/src/core/balances/net";
import { simplifyDebts } from "@/src/core/balances/simplify";
import {
  assertObjectId,
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { requireGroupMembership } from "@/src/server/groups/access";
import { mapExpense, mapSettlement } from "@/src/server/mappers";
import { Expense, GroupMember, Settlement, SplitUser } from "@/src/server/models";

type Params = { params: Promise<{ groupId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");

    const result = await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);
      const memberships = await GroupMember.find({
        groupId: new Types.ObjectId(groupId),
      }).lean();
      const memberIds = memberships.map((m) => m.userId.toString());
      const users = await SplitUser.find({
        _id: { $in: memberships.map((m) => m.userId) },
      }).lean();
      const names = Object.fromEntries(
        users.map((u) => [u._id.toString(), u.displayName]),
      );

      const expenses = await Expense.find(countedExpensesFilter(groupId)).lean();
      const settlements = await Settlement.find({
        groupId: new Types.ObjectId(groupId),
      }).lean();

      const mappedExpenses = expenses.map((doc) =>
        mapExpense(doc as typeof doc & { createdAt: Date; updatedAt: Date }),
      );
      const mappedSettlements = settlements.map((doc) =>
        mapSettlement(
          doc as typeof doc & { createdAt: Date; settledAt: Date },
        ),
      );

      const nets = computeNets({
        memberIds,
        expenses: mappedExpenses,
        settlements: mappedSettlements,
      });
      const simplified = simplifyDebts(nets);

      return {
        baseCurrency: group.baseCurrency,
        nets: nets.map((n) => ({
          ...n,
          displayName: names[n.userId] ?? "Member",
        })),
        simplified: simplified.map((d) => ({
          ...d,
          fromDisplayName: names[d.fromUserId] ?? "Member",
          toDisplayName: names[d.toUserId] ?? "Member",
        })),
        yourNet:
          nets.find((n) => n.userId === ctx.userId)?.netInBase ?? 0,
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

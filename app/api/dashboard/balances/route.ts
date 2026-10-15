import { countedExpensesFilter } from "@/src/server/expenses/counted";
import { Types } from "mongoose";
import { computeNets } from "@/src/core/balances/net";
import {
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { mapExpense, mapSettlement } from "@/src/server/mappers";
import {
  Expense,
  Group,
  GroupMember,
  Settlement,
} from "@/src/server/models";

export async function GET() {
  try {
    const ctx = await requireSplitSession();
    const result = await withDb(async () => {
      const memberships = await GroupMember.find({
        userId: new Types.ObjectId(ctx.userId),
      }).lean();
      const groupIds = memberships.map((m) => m.groupId);
      const groups = await Group.find({
        _id: { $in: groupIds },
        archivedAt: null,
      }).lean();

      const byCurrency: Record<
        string,
        { owedToYou: number; youOwe: number; groups: Array<{ groupId: string; name: string; net: number }> }
      > = {};

      let totalOwedToYou = 0;
      let totalYouOwe = 0;
      let singleCurrency: string | null = null;
      let mixed = false;

      for (const group of groups) {
        const memberIds = (
          await GroupMember.find({ groupId: group._id }).lean()
        ).map((m) => m.userId.toString());
        const expenses = await Expense.find(countedExpensesFilter(group._id)).lean();
        const settlements = await Settlement.find({
          groupId: group._id,
        }).lean();
        const nets = computeNets({
          memberIds,
          expenses: expenses.map((doc) =>
            mapExpense(
              doc as typeof doc & { createdAt: Date; updatedAt: Date },
            ),
          ),
          settlements: settlements.map((doc) =>
            mapSettlement(
              doc as typeof doc & { createdAt: Date; settledAt: Date },
            ),
          ),
        });
        const yours = nets.find((n) => n.userId === ctx.userId)?.netInBase ?? 0;
        const currency = group.baseCurrency;

        if (!byCurrency[currency]) {
          byCurrency[currency] = { owedToYou: 0, youOwe: 0, groups: [] };
        }
        if (yours > 0) byCurrency[currency].owedToYou += yours;
        if (yours < 0) byCurrency[currency].youOwe += -yours;
        byCurrency[currency].groups.push({
          groupId: group._id.toString(),
          name: group.name,
          net: yours,
        });

        if (singleCurrency == null) singleCurrency = currency;
        else if (singleCurrency !== currency) mixed = true;

        if (!mixed) {
          if (yours > 0) totalOwedToYou += yours;
          if (yours < 0) totalYouOwe += -yours;
        }
      }

      return {
        mixed,
        currency: mixed ? null : singleCurrency,
        owedToYou: mixed ? null : totalOwedToYou,
        youOwe: mixed ? null : totalYouOwe,
        byCurrency,
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

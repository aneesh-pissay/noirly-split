import { countedExpensesFilter } from "@/src/server/expenses/counted";
import { Types } from "mongoose";
import { formatMoney } from "@/src/core/money";
import {
  assertObjectId,
  jsonError,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { requireGroupMembership } from "@/src/server/groups/access";
import { Expense, SplitUser } from "@/src/server/models";

type Params = { params: Promise<{ groupId: string }> };

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");

    const csv = await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);
      const expenses = await Expense.find(countedExpensesFilter(groupId))
        .sort({ date: 1, createdAt: 1 })
        .lean();

      const userIds = new Set<string>();
      for (const e of expenses) {
        userIds.add(e.createdBy.toString());
        for (const p of e.payers) userIds.add(p.userId.toString());
        for (const s of e.splits) userIds.add(s.userId.toString());
      }
      const users = await SplitUser.find({
        _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) },
      }).lean();
      const names = Object.fromEntries(
        users.map((u) => [u._id.toString(), u.displayName]),
      );

      const header = [
        "date",
        "description",
        "category",
        "amount",
        "currency",
        "amount_in_base",
        "base_currency",
        "paid_by",
        "split_method",
        "participants",
      ].join(",");

      const rows = expenses.map((e) => {
        const paidBy = e.payers
          .map((p) => names[p.userId.toString()] ?? p.userId.toString())
          .join("; ");
        const participants = e.splits
          .map((s) => {
            const name = names[s.userId.toString()] ?? s.userId.toString();
            return `${name}:${formatMoney(s.amountOwed, e.currency)}`;
          })
          .join("; ");
        return [
          e.date,
          csvEscape(e.description),
          e.category ?? "",
          (e.amount / 100).toFixed(2),
          e.currency,
          (e.amountInBase / 100).toFixed(2),
          group.baseCurrency,
          csvEscape(paidBy),
          e.splitMethod,
          csvEscape(participants),
        ].join(",");
      });

      return [header, ...rows].join("\n");
    });

    const filename = `split-${groupId}-expenses.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

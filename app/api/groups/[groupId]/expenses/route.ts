import { Types } from "mongoose";
import { splitChannel } from "@/src/core/realtime/channels";
import {
  ApiError,
  assertObjectId,
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import {
  buildExpenseParts,
  createExpenseSchema,
} from "@/src/server/expenses/build";
import {
  notifyGroupMembers,
  recurrenceFromInput,
  spawnDueRecurringExpenses,
} from "@/src/server/expenses/lifecycle";
import { requireGroupMembership } from "@/src/server/groups/access";
import { isGroupReceiptUrl } from "@/src/server/storage/receipts";
import { assertExpensePeople } from "@/src/server/expenses/people";
import { mapExpense } from "@/src/server/mappers";
import { ActivityEvent, Expense, GroupMember } from "@/src/server/models";
import { publishRealtime } from "@/src/server/realtime/publish";
import { z } from "zod";

type Params = { params: Promise<{ groupId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const category = url.searchParams.get("category");

    const expenses = await withDb(async () => {
      await requireGroupMembership(groupId, ctx.userId);
      await spawnDueRecurringExpenses(groupId);

      const filter: Record<string, unknown> = {
        groupId: new Types.ObjectId(groupId),
        deletedAt: null,
        isRecurring: { $ne: true },
      };
      // Include templates that are also "instances"? Templates stay as recurring rows
      // but we list non-template expenses OR templates for editing — list instances only
      // plus one-off. Recurring templates have isRecurring true — hide from main list.
      if (category) filter.category = category;

      let docs = await Expense.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .lean();

      if (q) {
        docs = docs.filter((d) => d.description.toLowerCase().includes(q));
      }

      return docs.map((doc) =>
        mapExpense(doc as typeof doc & { createdAt: Date; updatedAt: Date }),
      );
    });

    return jsonOk({ expenses });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");
    const body = createExpenseSchema.parse(await request.json());

    const expense = await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);

      const memberIds = new Set(
        (
          await GroupMember.find({
            groupId: new Types.ObjectId(groupId),
          }).lean()
        ).map((m) => m.userId.toString()),
      );

      assertExpensePeople(memberIds, body);

      if (body.receiptUrl && !isGroupReceiptUrl(groupId, body.receiptUrl)) {
        throw new ApiError(400, "invalid_request", "Upload the receipt to this group first");
      }

      const parts = buildExpenseParts(body, group.baseCurrency);
      const recurrenceRule = recurrenceFromInput(body, body.date);
      const created = await Expense.create({
        groupId: new Types.ObjectId(groupId),
        amount: body.amount,
        currency: parts.currency,
        fxRateToBase: parts.fxRateToBase,
        amountInBase: parts.amountInBase,
        description: body.description,
        date: body.date,
        category: body.category ?? null,
        receiptUrl: body.receiptUrl ?? null,
        splitMethod: body.splitMethod,
        createdBy: new Types.ObjectId(ctx.userId),
        isRecurring: Boolean(body.isRecurring && recurrenceRule),
        recurrenceRule,
        recurrenceParentId: null,
        payers: parts.payers,
        splits: parts.splits,
        deletedAt: null,
      });

      // Also create the first instance when marking recurring
      let instance = created;
      if (created.isRecurring) {
        instance = await Expense.create({
          groupId: created.groupId,
          amount: created.amount,
          currency: created.currency,
          fxRateToBase: created.fxRateToBase,
          amountInBase: created.amountInBase,
          description: created.description,
          date: created.date,
          category: created.category,
          receiptUrl: created.receiptUrl,
          splitMethod: created.splitMethod,
          createdBy: created.createdBy,
          isRecurring: false,
          recurrenceRule: null,
          recurrenceParentId: created._id,
          payers: created.payers,
          splits: created.splits,
          deletedAt: null,
        });
      }

      const mapped = mapExpense(instance);
      await ActivityEvent.create({
        groupId: created.groupId,
        type: "expense.added",
        actorId: new Types.ObjectId(ctx.userId),
        payload: {
          expenseId: mapped.id,
          description: mapped.description,
          amount: mapped.amount,
          currency: mapped.currency,
        },
      });

      await publishRealtime({
        channel: splitChannel.group(groupId),
        event: "expense.added",
        data: { expense: mapped },
      });

      await notifyGroupMembers({
        groupId,
        actorId: ctx.userId,
        type: "expense.added",
        title: "New expense",
        body: `${ctx.displayName} added “${mapped.description}”`,
        href: `/g/${groupId}/expenses/${mapped.id}`,
      });

      return mapped;
    });

    return jsonOk({ expense }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        new ApiError(
          400,
          "invalid_request",
          error.issues[0]?.message ?? "Invalid body",
        ),
      );
    }
    return jsonError(error);
  }
}

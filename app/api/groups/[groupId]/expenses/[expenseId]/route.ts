import { Types } from "mongoose";
import { z } from "zod";
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
  patchExpenseSchema,
} from "@/src/server/expenses/build";
import { recurrenceFromInput } from "@/src/server/expenses/lifecycle";
import { requireGroupMembership } from "@/src/server/groups/access";
import { isGroupReceiptUrl } from "@/src/server/storage/receipts";
import { assertExpensePeople } from "@/src/server/expenses/people";
import { mapExpense } from "@/src/server/mappers";
import { ActivityEvent, Expense, GroupMember } from "@/src/server/models";
import { publishRealtime } from "@/src/server/realtime/publish";

type Params = { params: Promise<{ groupId: string; expenseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId, expenseId } = await params;
    await assertObjectId(groupId, "groupId");
    await assertObjectId(expenseId, "expenseId");

    const expense = await withDb(async () => {
      await requireGroupMembership(groupId, ctx.userId);
      const doc = await Expense.findOne({
        _id: expenseId,
        groupId: new Types.ObjectId(groupId),
        deletedAt: null,
      }).lean();
      if (!doc) throw new ApiError(404, "not_found", "Expense not found");
      return mapExpense(
        doc as typeof doc & { createdAt: Date; updatedAt: Date },
      );
    });

    return jsonOk({ expense });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId, expenseId } = await params;
    await assertObjectId(groupId, "groupId");
    await assertObjectId(expenseId, "expenseId");
    const body = patchExpenseSchema.parse(await request.json());

    const expense = await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);
      const existing = await Expense.findOne({
        _id: expenseId,
        groupId: new Types.ObjectId(groupId),
        deletedAt: null,
      });
      if (!existing) throw new ApiError(404, "not_found", "Expense not found");
      if (existing.createdBy.toString() !== ctx.userId) {
        throw new ApiError(403, "forbidden", "You can only edit your expenses");
      }

      const merged = createExpenseSchema.parse({
        amount: body.amount ?? existing.amount,
        currency: body.currency ?? existing.currency,
        fxRateToBase: body.fxRateToBase ?? existing.fxRateToBase,
        description: body.description ?? existing.description,
        date: body.date ?? existing.date,
        category:
          body.category !== undefined ? body.category : existing.category,
        receiptUrl:
          body.receiptUrl !== undefined
            ? body.receiptUrl
            : existing.receiptUrl,
        paidByUserId:
          body.paidByUserId ??
          body.payers?.[0]?.userId ??
          existing.payers[0]?.userId.toString(),
        payers:
          body.payers ??
          existing.payers.map((p) => ({
            userId: p.userId.toString(),
            amountPaid: p.amountPaid,
          })),
        splitMethod: body.splitMethod ?? existing.splitMethod,
        participantIds:
          body.participantIds ??
          existing.splits.map((s) => s.userId.toString()),
        allocations:
          body.allocations ??
          existing.splits.map((s) => ({
            userId: s.userId.toString(),
            amountOwed: s.amountOwed,
            percentage: s.percentage ?? undefined,
            shares: s.shares ?? undefined,
          })),
        isRecurring: body.isRecurring ?? existing.isRecurring,
        recurrence:
          body.recurrence !== undefined
            ? body.recurrence
            : existing.recurrenceRule
              ? {
                  frequency: existing.recurrenceRule.frequency,
                  interval: existing.recurrenceRule.interval,
                  endAt: existing.recurrenceRule.endAt
                    ? existing.recurrenceRule.endAt.toISOString()
                    : null,
                }
              : null,
      });

      const memberIds = new Set(
        (
          await GroupMember.find({
            groupId: new Types.ObjectId(groupId),
          }).lean()
        ).map((m) => m.userId.toString()),
      );
      // Same rules as creating: payers, participants and allocations are members.
      assertExpensePeople(memberIds, merged);

      // Only a newly set receipt is checked; an older one stays as it was.
      if (body.receiptUrl && !isGroupReceiptUrl(groupId, body.receiptUrl)) {
        throw new ApiError(400, "invalid_request", "Upload the receipt to this group first");
      }

      const parts = buildExpenseParts(merged, group.baseCurrency);
      existing.amount = merged.amount;
      existing.currency = parts.currency;
      existing.fxRateToBase = parts.fxRateToBase;
      existing.amountInBase = parts.amountInBase;
      existing.description = merged.description;
      existing.date = merged.date;
      existing.category = merged.category ?? null;
      existing.receiptUrl = merged.receiptUrl ?? null;
      existing.splitMethod = merged.splitMethod;
      existing.set("payers", parts.payers);
      existing.set("splits", parts.splits);
      if (body.isRecurring !== undefined || body.recurrence !== undefined) {
        existing.isRecurring = Boolean(merged.isRecurring);
        existing.recurrenceRule = recurrenceFromInput(merged, merged.date);
      }
      await existing.save();

      const mapped = mapExpense(existing);
      await ActivityEvent.create({
        groupId: existing.groupId,
        type: "expense.updated",
        actorId: new Types.ObjectId(ctx.userId),
        payload: { expenseId: mapped.id, description: mapped.description },
      });
      await publishRealtime({
        channel: splitChannel.group(groupId),
        event: "expense.updated",
        data: { expense: mapped },
      });
      return mapped;
    });

    return jsonOk({ expense });
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

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId, expenseId } = await params;
    await assertObjectId(groupId, "groupId");
    await assertObjectId(expenseId, "expenseId");

    await withDb(async () => {
      await requireGroupMembership(groupId, ctx.userId);
      const existing = await Expense.findOne({
        _id: expenseId,
        groupId: new Types.ObjectId(groupId),
        deletedAt: null,
      });
      if (!existing) throw new ApiError(404, "not_found", "Expense not found");
      if (existing.createdBy.toString() !== ctx.userId) {
        throw new ApiError(
          403,
          "forbidden",
          "You can only delete your expenses",
        );
      }
      existing.deletedAt = new Date();
      await existing.save();
      await ActivityEvent.create({
        groupId: existing.groupId,
        type: "expense.deleted",
        actorId: new Types.ObjectId(ctx.userId),
        payload: {
          expenseId: existing._id.toString(),
          description: existing.description,
        },
      });
      await publishRealtime({
        channel: splitChannel.group(groupId),
        event: "expense.deleted",
        data: { expenseId: existing._id.toString() },
      });
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

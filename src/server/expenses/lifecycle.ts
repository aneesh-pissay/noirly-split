import { Types } from "mongoose";
import { splitChannel } from "@/src/core/realtime/channels";
import {
  addWeeklyMonthly,
  toISODate,
} from "@/src/core/recurrence/next";
import { mapExpense } from "@/src/server/mappers";
import {
  ActivityEvent,
  Expense,
  GroupMember,
  Notification,
  type ExpenseDocument,
} from "@/src/server/models";
import { publishRealtime } from "@/src/server/realtime/publish";

/** Spawn due recurring expense instances for a group (on-read). */
export async function spawnDueRecurringExpenses(
  groupId: string,
  now = new Date(),
): Promise<number> {
  const templates = await Expense.find({
    groupId: new Types.ObjectId(groupId),
    isRecurring: true,
    deletedAt: null,
    "recurrenceRule.nextRunAt": { $lte: now },
  });

  let spawned = 0;
  for (const template of templates) {
    const rule = template.recurrenceRule;
    if (!rule) continue;
    if (rule.endAt && rule.endAt.getTime() < now.getTime()) continue;

    // Claim this occurrence by moving the schedule on in one atomic step.
    // Opening a group runs this, so two people opening it at once would both
    // see the same due date; only the one whose update lands creates it.
    const dueAt = rule.nextRunAt;
    const followingRunAt = addWeeklyMonthly(dueAt, {
      frequency: rule.frequency,
      interval: rule.interval,
    });
    const claimed = await Expense.updateOne(
      { _id: template._id, "recurrenceRule.nextRunAt": dueAt },
      { $set: { "recurrenceRule.nextRunAt": followingRunAt } },
    );
    if (claimed.modifiedCount !== 1) continue;

    const nextDate = toISODate(dueAt);
    const created = await Expense.create({
      groupId: template.groupId,
      amount: template.amount,
      currency: template.currency,
      fxRateToBase: template.fxRateToBase,
      amountInBase: template.amountInBase,
      description: template.description,
      date: nextDate,
      category: template.category,
      receiptUrl: null,
      splitMethod: template.splitMethod,
      createdBy: template.createdBy,
      isRecurring: false,
      recurrenceRule: null,
      recurrenceParentId: template._id,
      payers: template.payers,
      splits: template.splits,
      deletedAt: null,
    });

    const mapped = mapExpense(created);
    await ActivityEvent.create({
      groupId: template.groupId,
      type: "expense.added",
      actorId: template.createdBy,
      payload: {
        expenseId: mapped.id,
        description: mapped.description,
        amount: mapped.amount,
        currency: mapped.currency,
        recurring: true,
      },
    });
    await publishRealtime({
      channel: splitChannel.group(groupId),
      event: "expense.added",
      data: { expense: mapped },
    });
    spawned += 1;
  }
  return spawned;
}

export async function notifyGroupMembers(opts: {
  groupId: string;
  actorId: string;
  type: "expense.added" | "settlement.recorded" | "member.joined";
  title: string;
  body: string;
  href: string;
}) {
  const members = await GroupMember.find({
    groupId: new Types.ObjectId(opts.groupId),
  }).lean();

  for (const member of members) {
    const userId = member.userId.toString();
    if (userId === opts.actorId) continue;
    const notification = await Notification.create({
      userId: member.userId,
      groupId: new Types.ObjectId(opts.groupId),
      type: opts.type,
      title: opts.title,
      body: opts.body,
      href: opts.href,
      readAt: null,
    });
    await publishRealtime({
      channel: splitChannel.user(userId),
      event: "notification.created",
      data: {
        notification: {
          id: notification._id.toString(),
          userId,
          groupId: opts.groupId,
          type: opts.type,
          title: opts.title,
          body: opts.body,
          href: opts.href,
          readAt: null,
          createdAt: notification.createdAt.toISOString(),
        },
      },
    });
  }
}

export function recurrenceFromInput(
  input: {
    isRecurring?: boolean;
    recurrence?: {
      frequency: "weekly" | "monthly";
      interval: number;
      endAt?: string | null;
    } | null;
  },
  expenseDate: string,
): ExpenseDocument["recurrenceRule"] {
  if (!input.isRecurring || !input.recurrence) return null;
  const nextRunAt = addWeeklyMonthly(new Date(`${expenseDate}T12:00:00`), {
    frequency: input.recurrence.frequency,
    interval: input.recurrence.interval,
  });
  return {
    frequency: input.recurrence.frequency,
    interval: input.recurrence.interval,
    nextRunAt,
    endAt: input.recurrence.endAt ? new Date(input.recurrence.endAt) : null,
  };
}

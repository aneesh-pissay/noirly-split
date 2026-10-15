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
import { requireGroupMembership } from "@/src/server/groups/access";
import { mapSettlement } from "@/src/server/mappers";
import {
  ActivityEvent,
  GroupMember,
  Settlement,
} from "@/src/server/models";
import { publishRealtime } from "@/src/server/realtime/publish";

const createSettlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.number().int().positive(),
  note: z.string().trim().max(200).nullable().optional(),
});

type Params = { params: Promise<{ groupId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");

    const settlements = await withDb(async () => {
      await requireGroupMembership(groupId, ctx.userId);
      const docs = await Settlement.find({
        groupId: new Types.ObjectId(groupId),
      })
        .sort({ settledAt: -1 })
        .lean();
      return docs.map((doc) =>
        mapSettlement(
          doc as typeof doc & { createdAt: Date; settledAt: Date },
        ),
      );
    });

    return jsonOk({ settlements });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");
    const body = createSettlementSchema.parse(await request.json());

    if (body.fromUserId === body.toUserId) {
      throw new ApiError(
        400,
        "invalid_request",
        "from and to must be different people",
      );
    }
    // A payment clears a debt, so only the person who paid or the person who
    // was paid may record it; nobody can wipe out other people's debts.
    if (ctx.userId !== body.fromUserId && ctx.userId !== body.toUserId) {
      throw new ApiError(
        403,
        "forbidden",
        "Only the person who paid or the person who was paid can record a payment",
      );
    }

    const settlement = await withDb(async () => {
      const { group } = await requireGroupMembership(groupId, ctx.userId);
      const memberIds = new Set(
        (
          await GroupMember.find({
            groupId: new Types.ObjectId(groupId),
          }).lean()
        ).map((m) => m.userId.toString()),
      );
      if (!memberIds.has(body.fromUserId) || !memberIds.has(body.toUserId)) {
        throw new ApiError(400, "invalid_request", "Both parties must be members");
      }

      const created = await Settlement.create({
        groupId: new Types.ObjectId(groupId),
        fromUserId: new Types.ObjectId(body.fromUserId),
        toUserId: new Types.ObjectId(body.toUserId),
        amount: body.amount,
        currency: group.baseCurrency,
        note: body.note ?? null,
        settledAt: new Date(),
        createdBy: new Types.ObjectId(ctx.userId),
      });

      const mapped = mapSettlement(created);
      await ActivityEvent.create({
        groupId: created.groupId,
        type: "settlement.recorded",
        actorId: new Types.ObjectId(ctx.userId),
        payload: {
          settlementId: mapped.id,
          fromUserId: mapped.fromUserId,
          toUserId: mapped.toUserId,
          amount: mapped.amount,
          currency: mapped.currency,
          note: mapped.note,
        },
      });
      await publishRealtime({
        channel: splitChannel.group(groupId),
        event: "settlement.recorded",
        data: { settlement: mapped },
      });
      const { notifyGroupMembers } = await import(
        "@/src/server/expenses/lifecycle"
      );
      await notifyGroupMembers({
        groupId,
        actorId: ctx.userId,
        type: "settlement.recorded",
        title: "Settlement recorded",
        body: `${ctx.displayName} recorded a settlement`,
        href: `/g/${groupId}`,
      });
      return mapped;
    });

    return jsonOk({ settlement }, 201);
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

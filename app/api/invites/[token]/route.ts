import { Types } from "mongoose";
import { splitChannel } from "@/src/core/realtime/channels";
import {
  ApiError,
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { mapGroup, mapMember } from "@/src/server/mappers";
import {
  ActivityEvent,
  Group,
  GroupInvite,
  GroupMember,
  SplitUser,
} from "@/src/server/models";
import { publishRealtime } from "@/src/server/realtime/publish";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const preview = await withDb(async () => {
      const invite = await GroupInvite.findOne({ token }).lean();
      if (!invite) {
        throw new ApiError(404, "not_found", "Invite not found");
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new ApiError(410, "expired", "Invite has expired");
      }
      const group = await Group.findById(invite.groupId).lean();
      if (!group) {
        throw new ApiError(404, "not_found", "Group not found");
      }
      return {
        group: mapGroup(
          group as typeof group & { createdAt: Date; updatedAt: Date },
        ),
        email: invite.email,
        expiresAt: invite.expiresAt.toISOString(),
        acceptedAt: invite.acceptedAt
          ? invite.acceptedAt.toISOString()
          : null,
      };
    });
    return jsonOk(preview);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { token } = await params;

    const result = await withDb(async () => {
      const invite = await GroupInvite.findOne({ token });
      if (!invite) {
        throw new ApiError(404, "not_found", "Invite not found");
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new ApiError(410, "expired", "Invite has expired");
      }

      const group = await Group.findById(invite.groupId);
      if (!group) {
        throw new ApiError(404, "not_found", "Group not found");
      }

      const existing = await GroupMember.findOne({
        groupId: group._id,
        userId: new Types.ObjectId(ctx.userId),
      }).lean();

      // An invite sent to an address is for that person only, and works once.
      // (A link without an address is a shareable link, as before.)
      if (invite.email && !existing) {
        if (invite.email !== ctx.email.trim().toLowerCase()) {
          throw new ApiError(
            403,
            "forbidden",
            "This invite was sent to a different email address. Sign in with that account, or ask for a new link.",
          );
        }
        const claimed = await GroupInvite.updateOne(
          { _id: invite._id, acceptedAt: null },
          { $set: { acceptedAt: new Date() } },
        );
        if (claimed.modifiedCount !== 1) {
          throw new ApiError(410, "expired", "This invite has already been used");
        }
      }

      if (!existing) {
        await GroupMember.create({
          groupId: group._id,
          userId: new Types.ObjectId(ctx.userId),
          joinedAt: new Date(),
        });
        await ActivityEvent.create({
          groupId: group._id,
          type: "member.joined",
          actorId: new Types.ObjectId(ctx.userId),
          payload: { userId: ctx.userId },
        });
        const user = await SplitUser.findById(ctx.userId).lean();
        const member = await GroupMember.findOne({
          groupId: group._id,
          userId: new Types.ObjectId(ctx.userId),
        }).lean();
        if (member) {
          await publishRealtime({
            channel: splitChannel.group(group._id.toString()),
            event: "member.joined",
            data: {
              member: mapMember(member, user),
            },
          });
        }
      }

      if (!invite.acceptedAt) {
        invite.acceptedAt = new Date();
        await invite.save();
      }

      return {
        groupId: group._id.toString(),
        group: mapGroup(group),
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

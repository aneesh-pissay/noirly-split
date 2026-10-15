import {
  ApiError,
  assertObjectId,
  jsonError,
  jsonOk,
  requireSplitSession,
} from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { requireGroupMembership } from "@/src/server/groups/access";
import { saveReceipt } from "@/src/server/storage/receipts";

type Params = { params: Promise<{ groupId: string }> };

/** Upload a receipt photo for this group (members only). */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId } = await params;
    await assertObjectId(groupId, "groupId");
    await withDb(() => requireGroupMembership(groupId, ctx.userId));
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "file is required");
    }
    const saved = await saveReceipt(groupId, {
      bytes: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
    });
    return jsonOk({ url: saved.url }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

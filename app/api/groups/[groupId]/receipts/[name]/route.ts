import { ApiError, jsonError, requireSplitSession } from "@/src/server/api/http";
import { withDb } from "@/src/server/db/mongodb";
import { requireGroupMembership } from "@/src/server/groups/access";
import { readReceipt } from "@/src/server/storage/receipts";

type Params = { params: Promise<{ groupId: string; name: string }> };

/** A receipt photo, for members of its group only. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireSplitSession();
    const { groupId, name } = await params;
    // Outsiders get the same 404 as a missing file, so names can't be probed.
    await withDb(() => requireGroupMembership(groupId, ctx.userId)).catch(() => {
      throw new ApiError(404, "not_found", "Receipt not found");
    });
    const { bytes, mime } = await readReceipt(groupId, name);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
        "content-disposition": "inline",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

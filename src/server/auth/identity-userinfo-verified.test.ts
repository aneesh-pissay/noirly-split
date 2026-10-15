import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearIdentityUserInfoCache,
  fetchIdentityUserInfo,
} from "@/src/server/auth/identity-userinfo";

/** Identity's userinfo answer for a mobile access token. */
function identityReplies(body: Record<string, unknown>) {
  // Typed like fetch so the test can read back the options it was called with.
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => Response.json(body),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sub = "6a0c1f2e3d4b5a6978809a1b";

describe("fetchIdentityUserInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIdentityUserInfoCache();
  });

  it("accepts a verified email", async () => {
    identityReplies({ sub, email: "ada@example.com", email_verified: true });
    await expect(fetchIdentityUserInfo("token-verified")).resolves.toMatchObject({ sub });
  });

  it("refuses an email Identity hasn't verified", async () => {
    identityReplies({ sub, email: "squatter@example.com", email_verified: false });
    await expect(fetchIdentityUserInfo("token-unverified")).rejects.toThrow(/not verified/);
    // A missing claim is not a yes.
    identityReplies({ sub, email: "squatter@example.com" });
    await expect(fetchIdentityUserInfo("token-no-claim")).rejects.toThrow(/not verified/);
  });

  it("times out and never follows redirects", async () => {
    const fetchMock = identityReplies({ sub, email_verified: true });
    await fetchIdentityUserInfo("token-options");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the cache bounded", async () => {
    const fetchMock = identityReplies({ sub, email_verified: true });
    for (let i = 0; i < 5_001; i++) await fetchIdentityUserInfo(`token-${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(5_001);
    // Reaching the limit emptied the cache, so an early token is fetched again…
    await fetchIdentityUserInfo("token-0");
    expect(fetchMock).toHaveBeenCalledTimes(5_002);
    // …while a recent one is still answered from the cache.
    await fetchIdentityUserInfo("token-5000");
    expect(fetchMock).toHaveBeenCalledTimes(5_002);
  });
});

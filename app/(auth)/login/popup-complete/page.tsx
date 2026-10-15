"use client";

import { safeLocalPath } from "@/src/lib/safe-path";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SplitBusyScreen } from "@/src/components/SplitBusyScreen";

const AUTH_MESSAGE = "noirly-auth";
const AUTH_STORAGE_KEY = "noirly-auth";

function safeNext(value: string | null): string {
  return safeLocalPath(value, "/");
}

function PopupCompleteInner() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  useEffect(() => {
    const payload = { type: AUTH_MESSAGE, next, t: Date.now() };
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota / private mode */
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin);
      window.close();
      return;
    }
    window.location.replace(next);
  }, [next]);

  return <SplitBusyScreen label="Signed in. Returning to Split" />;
}

export default function LoginPopupCompletePage() {
  return (
    <Suspense fallback={<SplitBusyScreen label="Finishing sign-in" />}>
      <PopupCompleteInner />
    </Suspense>
  );
}

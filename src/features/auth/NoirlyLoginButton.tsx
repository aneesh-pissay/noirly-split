"use client";

import { safeLocalPath } from "@/src/lib/safe-path";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SplitBusyScreen } from "@/src/components/SplitBusyScreen";

const AUTH_MESSAGE = "noirly-auth";
const AUTH_STORAGE_KEY = "noirly-auth";

function safeNext(value: string): string {
  return safeLocalPath(value, "/home");
}

function readAuthPayload(): { next?: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { next?: string };
  } catch {
    return null;
  }
}

function popupFeatures() {
  const width = 480;
  const height = 740;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2),
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2),
  );
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

function subscribeNoop() {
  return () => {};
}

export function NoirlyLoginButton({
  redirectTo = "/home",
}: {
  redirectTo?: string;
}) {
  const target = safeNext(redirectTo);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const signedInRef = useRef(false);

  useEffect(() => {
    function finish(next: string) {
      if (signedInRef.current) return;
      signedInRef.current = true;
      setSignedIn(true);
      setWaiting(true);
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      window.location.assign(safeNext(next));
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; next?: string } | null;
      if (data?.type !== AUTH_MESSAGE) return;
      finish(data.next ?? target);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== AUTH_STORAGE_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as { next?: string };
        finish(payload.next ?? target);
      } catch {
        finish(target);
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, [target]);

  function watchPopup(popup: Window) {
    const timer = window.setInterval(() => {
      try {
        if (!popup.closed) return;
        window.clearInterval(timer);
        const payload = readAuthPayload();
        if (payload) {
          if (signedInRef.current) return;
          signedInRef.current = true;
          setSignedIn(true);
          setWaiting(true);
          try {
            localStorage.removeItem(AUTH_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          window.location.assign(safeNext(payload.next ?? target));
          return;
        }
        window.setTimeout(() => {
          if (!signedInRef.current) setWaiting(false);
        }, 600);
      } catch {
        window.clearInterval(timer);
        if (!signedInRef.current) setWaiting(false);
      }
    }, 300);
  }

  function openIdentityPopup() {
    setError(null);
    setSignedIn(false);
    signedInRef.current = false;
    setWaiting(true);
    const popup = window.open(
      `/login/popup?next=${encodeURIComponent(target)}`,
      "noirly-identity",
      popupFeatures(),
    );
    if (!popup) {
      setWaiting(false);
      setError("Allow popups for Noirly Split, then try again.");
      return;
    }
    popup.focus();
    watchPopup(popup);
  }

  return (
    <div className="flex flex-col gap-3">
      {mounted && waiting
        ? createPortal(
            <SplitBusyScreen
              label={signedIn ? "Signing in to Split" : "Waiting for Identity"}
            />,
            document.body,
          )
        : null}
      <button
        className="flex h-12 w-full cursor-pointer items-center justify-center bg-[var(--accent-ink)] px-5 font-mono text-[11px] font-semibold tracking-[0.16em] text-[var(--accent)] uppercase transition-colors hover:bg-transparent hover:text-[var(--accent-ink)] hover:outline hover:outline-1 hover:outline-dashed hover:outline-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        onClick={openIdentityPopup}
        disabled={waiting}
      >
        {signedIn
          ? "Signing in…"
          : waiting
            ? "Waiting for Identity…"
            : "Noirly Login"}
      </button>
      {error ? (
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--accent-ink)]/70">
          {error}
        </p>
      ) : null}
    </div>
  );
}

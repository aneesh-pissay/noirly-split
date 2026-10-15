import { safeLocalPath } from "@/src/lib/safe-path";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@noirly-dev/ui";
import { BrandMark } from "@/src/components/BrandMark";
import { NoirlyLoginButton } from "@/src/features/auth/NoirlyLoginButton";

export const metadata: Metadata = {
  title: "Sign in · Noirly Split",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo =
    safeLocalPath(next, "/home");

  return (
    <AuthShell
      logo={<BrandMark className="size-14 brand-mark--on-surface md:size-16" />}
      title="Sign in to Split"
      lead="Email, Google and verification are handled by Noirly Identity. No separate password to remember."
      footer={
        <>
          New here?{" "}
          <Link href="/" className="text-[var(--accent)] hover:underline">
            See what Split does
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NoirlyLoginButton redirectTo={redirectTo} />
        <p className="meta text-center">Opens Identity in a secure popup</p>
      </div>
    </AuthShell>
  );
}

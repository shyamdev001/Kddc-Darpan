import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · KDCC Darpan" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            દ
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">KDCC Darpan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Digital signage for Kheda District Central Co-operative Bank
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Head office staff only. Every sign-in is recorded.
        </p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark, BrandScreen } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in | KDCC Darpan" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen flex-1 lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-ink px-6 py-8 text-white sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-3">
          <BrandMark className="bg-white/10 ring-white/15" />
          <span className="font-heading text-lg font-medium tracking-tight">KDCC Darpan</span>
        </div>

        <div className="my-10 flex justify-center lg:my-0">
          <BrandScreen />
        </div>

        <div className="hidden max-w-md lg:block">
          <p className="font-heading text-2xl leading-snug font-medium text-white">
            One screen at head office for every screen in every branch.
          </p>
          <p className="mt-3 text-sm text-white/60">
            The Kheda District Central Co-operative Bank network: 93 branches, 101 displays.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center bg-background px-6 py-12 sm:px-10">
        <div className="w-full max-w-[360px]">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-muted-foreground">Use the email and password from your head office administrator.</p>

          <div className="mt-8">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>

          <p className="mt-10 border-t pt-5 text-sm text-muted-foreground">
            For KDCC head office staff. Each sign-in is recorded with the time and network address.
          </p>
        </div>
      </section>
    </main>
  );
}

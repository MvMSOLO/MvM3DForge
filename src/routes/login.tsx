import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: LoginPage });

type FormMode = "signin" | "signup";

function getReturnPath(): string {
  if (typeof window === "undefined") return "/studio";
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/studio";
  try {
    const target = new URL(requested, window.location.origin);
    if (target.origin !== window.location.origin) return "/studio";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/studio";
  }
}

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<FormMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const cleanEmail = email.trim().toLowerCase();
    if (mode === "signup" && name.trim().length < 2) {
      setError("Enter your name (at least 2 characters).");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const callbackURL = getReturnPath();
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: cleanEmail,
              password,
              callbackURL,
            })
          : await authClient.signIn.email({
              email: cleanEmail,
              password,
              callbackURL,
            });

      if (result.error) {
        const details = result.error as unknown as {
          message?: unknown;
          status?: unknown;
          code?: unknown;
        };
        const fallback = mode === "signup" ? "Could not create your account." : "Could not sign in.";
        const message =
          typeof details.message === "string" && details.message.trim()
            ? details.message
            : details.code === "AUTH_DATABASE_NOT_CONFIGURED" || details.status === 503
              ? "Account storage is not connected on this deployment yet. A persistent database must be connected before accounts can be created or used."
              : typeof details.status === "number" && details.status >= 500
                ? "The authentication server could not complete this request. Check that the deployment database is connected, then try again."
                : fallback;
        setError(message);
        return;
      }

      setNotice(mode === "signup" ? "Account created. Opening MVM 3D Forge…" : "Signed in. Opening MVM 3D Forge…");
      window.location.assign(callbackURL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080d12] px-4 py-10 text-[#e8f0f6]">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -top-40 left-[20%] h-[30rem] w-[30rem] rounded-full bg-[#43d9b3]/[0.09] blur-[120px]" />
        <div className="absolute -bottom-48 right-[8%] h-[32rem] w-[32rem] rounded-full bg-[#568cff]/[0.08] blur-[130px]" />
        <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(160,190,210,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(160,190,210,.14) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "linear-gradient(to bottom, black, transparent 85%)" }} />
      </div>

      <section className="relative z-10 w-full max-w-md">
        <a href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-[#91a0ad] transition hover:text-[#83f0ce]">
          <ArrowLeft size={14} /> Back to home
        </a>

        <div className="rounded-2xl border border-white/[0.12] bg-[#101821]/95 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <div className="mb-7 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-[#83f0ce]/30 bg-[#83f0ce]/[0.08] text-[#83f0ce]">
              <Box size={22} />
            </span>
            <div>
              <div className="text-sm font-bold tracking-[0.12em]">MVM <span className="text-[#83f0ce]">3D</span> FORGE</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#6f8190]">Your creative workspace</div>
            </div>
          </div>

          {isPending ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
              <LoaderCircle size={24} className="animate-spin text-[#83f0ce]" />
              <p className="text-sm text-[#a9b7c5]">Checking your session…</p>
            </div>
          ) : user ? (
            <div className="py-7 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full border border-[#83f0ce]/25 bg-[#83f0ce]/[0.08] text-[#83f0ce]">
                <CheckCircle2 size={24} />
              </span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">You’re signed in</h1>
              <p className="mt-2 text-sm text-[#95a5b3]">{user.primaryEmail ?? user.displayName ?? "Your account"} is ready to use.</p>
              <a href={getReturnPath()} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#83f0ce] px-4 py-3 text-sm font-semibold text-[#071511] transition hover:bg-[#a1f7dc]">
                Continue to Studio
              </a>
            </div>
          ) : !authEnabled ? (
            <div className="py-6">
              <h1 className="text-2xl font-semibold tracking-tight">Sign-in is disabled</h1>
              <p className="mt-3 text-sm leading-6 text-[#95a5b3]">Authentication is not enabled for this deployment yet. The account form will appear once the app is configured for real sign-in.</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#83f0ce]">Secure account access</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                  {mode === "signin" ? "Welcome back." : "Create your account."}
                </h1>
                <p className="mt-2 text-sm leading-6 text-[#95a5b3]">
                  {mode === "signin"
                    ? "Sign in to open your private 3D projects and approve secure AI-client connections."
                    : "One account for your 3D projects and secure OAuth connections."}
                </p>
              </div>

              <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/[0.09] bg-black/20 p-1">
                <button type="button" onClick={() => { setMode("signin"); setError(""); setNotice(""); }} className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition ${mode === "signin" ? "bg-[#202d37] text-white shadow" : "text-[#7f8e9b] hover:text-white"}`}>
                  Sign in
                </button>
                <button type="button" onClick={() => { setMode("signup"); setError(""); setNotice(""); }} className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition ${mode === "signup" ? "bg-[#202d37] text-white shadow" : "text-[#7f8e9b] hover:text-white"}`}>
                  Create account
                </button>
              </div>

              <form onSubmit={(event) => void submit(event)} className="space-y-4">
                {mode === "signup" && (
                  <label className="block text-xs font-medium text-[#a8b5c0]">
                    Name
                    <span className="relative mt-1.5 block">
                      <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#637584]" />
                      <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} className="w-full rounded-xl border border-white/[0.1] bg-[#080d12] py-3 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-[#50606e] focus:border-[#83f0ce]/60" placeholder="Your name" />
                    </span>
                  </label>
                )}
                <label className="block text-xs font-medium text-[#a8b5c0]">
                  Email
                  <span className="relative mt-1.5 block">
                    <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#637584]" />
                    <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} className="w-full rounded-xl border border-white/[0.1] bg-[#080d12] py-3 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-[#50606e] focus:border-[#83f0ce]/60" placeholder="you@example.com" />
                  </span>
                </label>
                <label className="block text-xs font-medium text-[#a8b5c0]">
                  Password
                  <span className="relative mt-1.5 block">
                    <LockKeyhole size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#637584]" />
                    <input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} className="w-full rounded-xl border border-white/[0.1] bg-[#080d12] py-3 pl-9 pr-11 text-sm text-white outline-none transition placeholder:text-[#50606e] focus:border-[#83f0ce]/60" placeholder="At least 8 characters" />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((shown) => !shown)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f8190] transition hover:text-white">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                </label>

                {error && <div role="alert" className="rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-2.5 text-xs leading-5 text-red-200">{error}</div>}
                {notice && <div role="status" className="rounded-xl border border-[#83f0ce]/25 bg-[#83f0ce]/[0.06] px-3 py-2.5 text-xs leading-5 text-[#a8f4dc]">{notice}</div>}

                <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#83f0ce] px-4 py-3 text-sm font-bold text-[#071511] transition hover:bg-[#a1f7dc] disabled:cursor-wait disabled:opacity-60">
                  {submitting ? <LoaderCircle size={16} className="animate-spin" /> : null}
                  {submitting ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>

              <div className="mt-5 flex items-start gap-2 border-t border-white/[0.08] pt-4 text-[10px] leading-5 text-[#71818f]">
                <LockKeyhole size={13} className="mt-0.5 shrink-0 text-[#83f0ce]" />
                Your session stays on MVM 3D Forge. API keys are only shown once when created.
              </div>
            </>
          )}
        </div>
        <p className="mt-5 text-center text-[10px] text-[#62717e]">© {new Date().getFullYear()} MvMSOLO · MVM 3D Forge</p>
      </section>
    </main>
  );
}

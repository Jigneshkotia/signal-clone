"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ArrowLeftIcon, CheckIcon, LockIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, api } from "@/lib/api";
import { CONVERSATION_COLORS, colorFor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import type { AvatarColor } from "@/types/api";

type Step = "signin" | "identify" | "verify" | "profile";

/** The seeded accounts, offered as one-tap sign-ins for reviewers. */
const DEMO_ACCOUNTS = [
  { name: "Jignesh Kotia", phone: "+15550100001", primary: true },
  { name: "Aisha Raman", phone: "+15550100002", primary: false },
  { name: "Daniel Osei", phone: "+15550100003", primary: false },
];
const DEMO_PASSWORD = "signal123";

export default function OnboardingPage() {
  const router = useRouter();
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const busy = useAuthStore((state) => state.busy);
  const toast = useUiStore((state) => state.toast);

  const [step, setStep] = useState<Step>("signin");
  const [mode, setMode] = useState<"phone" | "username">("phone");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState<AvatarColor>("ultramarine");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Already signed in: go straight to the app.
  useEffect(() => {
    if (ready && user) router.replace("/chat");
  }, [ready, user, router]);

  if (!ready || user) {
    return (
      <main className="flex h-full items-center justify-center bg-app">
        <Spinner size={26} className="text-ultramarine" />
      </main>
    );
  }

  const signIn = async (id: string, pw: string) => {
    setError(null);
    try {
      await login(id, pw);
      router.replace("/chat");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not sign in",
      );
    }
  };

  /** Step 1 -> 2: ask the server to "send" a code. */
  const requestCode = async () => {
    const value = identifier.trim();
    if (!value) {
      setError(mode === "phone" ? "Enter a phone number" : "Enter a username");
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const challenge = await api.auth.requestOtp(
        mode === "phone" ? { phone_number: value } : { username: value },
      );
      // Verification is mocked, so prefill the code it just told us.
      setCode(challenge.demo_code);
      setColor(colorFor(value));
      setStep("verify");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not send a code",
      );
    } finally {
      setChecking(false);
    }
  };

  /** Step 2 -> 3. */
  const verifyCode = async () => {
    setChecking(true);
    setError(null);
    try {
      await api.auth.verifyOtp({
        ...(mode === "phone"
          ? { phone_number: identifier.trim() }
          : { username: identifier.trim() }),
        code: code.trim(),
      });
      setStep("profile");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Invalid code");
    } finally {
      setChecking(false);
    }
  };

  /** Step 3: create the account. */
  const finish = async () => {
    if (!displayName.trim()) {
      setError("Enter a display name");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setError(null);
    try {
      await register({
        ...(mode === "phone"
          ? { phone_number: identifier.trim() }
          : { username: identifier.trim() }),
        display_name: displayName.trim(),
        password,
      });
      toast("Welcome to Signal", "success");
      router.replace("/chat");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create your account",
      );
    }
  };

  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-pane px-4 py-8">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ultramarine">
            <LockIcon size={30} className="text-white" strokeWidth={2} />
          </div>
          <div className="text-center">
            <h1 className="text-[26px] font-semibold leading-[32px] text-primary">
              Signal
            </h1>
            <p className="mt-1 text-[13px] leading-[18px] text-secondary">
              Private messaging. Simulated encryption.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--surface-raised)] p-5 shadow-[0_1px_8px_rgb(0_0_0/0.06)]">
          {step !== "signin" && (
            <IconButton
              label="Back"
              className="-ml-2 mb-1"
              onClick={() => {
                setError(null);
                setStep(
                  step === "verify"
                    ? "identify"
                    : step === "profile"
                      ? "verify"
                      : "signin",
                );
              }}
            >
              <ArrowLeftIcon size={18} />
            </IconButton>
          )}

          {step === "signin" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
                  Sign in
                </h2>
                <p className="mt-0.5 text-[13px] leading-[18px] text-secondary">
                  Use a phone number or username.
                </p>
              </div>

              <Input
                name="identifier"
                label="Phone number or username"
                placeholder="+1 555 010 0001"
                value={identifier}
                autoComplete="username"
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setError(null);
                }}
              />
              <Input
                name="password"
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                error={error}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void signIn(identifier, password);
                }}
              />

              <Button
                fullWidth
                size="lg"
                loading={busy}
                onClick={() => void signIn(identifier, password)}
              >
                Sign in
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setIdentifier("");
                  setPassword("");
                  setError(null);
                }}
                className="text-[13px] font-medium text-link hover:underline"
              >
                Create a new account
              </button>

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="pb-2 text-[12px] font-medium uppercase tracking-wide text-tertiary">
                  Demo accounts
                </p>
                <div className="flex flex-col gap-1">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.phone}
                      type="button"
                      onClick={() => void signIn(account.phone, DEMO_PASSWORD)}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                    >
                      <Avatar
                        name={account.name}
                        color={colorFor(account.name)}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-primary">
                          {account.name}
                          {account.primary && (
                            <span className="ml-1.5 text-[11px] text-tertiary">
                              most data
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-tertiary">
                          {account.phone}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="pt-2 text-[11px] leading-[15px] text-tertiary">
                  All demo accounts use the password{" "}
                  <code className="rounded bg-[var(--surface-input)] px-1">
                    {DEMO_PASSWORD}
                  </code>
                </p>
              </div>
            </div>
          )}

          {step === "identify" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
                  Your number
                </h2>
                <p className="mt-0.5 text-[13px] leading-[18px] text-secondary">
                  We&apos;ll send a verification code. Nothing is actually sent —
                  verification is mocked.
                </p>
              </div>

              <div className="flex gap-1 rounded-full bg-[var(--surface-input)] p-1">
                {(["phone", "username"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setMode(option);
                      setError(null);
                    }}
                    className={cn(
                      "flex-1 rounded-full py-1.5 text-[13px] font-medium transition-colors",
                      mode === option
                        ? "bg-ultramarine text-white"
                        : "text-secondary hover:text-primary",
                    )}
                  >
                    {option === "phone" ? "Phone number" : "Username"}
                  </button>
                ))}
              </div>

              <Input
                name="new-identifier"
                label={mode === "phone" ? "Phone number" : "Username"}
                placeholder={mode === "phone" ? "+1 555 010 1234" : "yourname"}
                value={identifier}
                error={error}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void requestCode();
                }}
              />

              <Button
                fullWidth
                size="lg"
                loading={checking}
                onClick={requestCode}
              >
                Continue
              </Button>
            </div>
          )}

          {step === "verify" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
                  Enter the code
                </h2>
                <p className="mt-0.5 text-[13px] leading-[18px] text-secondary">
                  Sent to {identifier.trim()}. It&apos;s prefilled, because the
                  code is fixed in this build.
                </p>
              </div>

              <Input
                name="code"
                label="Verification code"
                value={code}
                inputMode="numeric"
                maxLength={8}
                error={error}
                className="text-center text-[20px] tracking-[0.3em]"
                onChange={(event) => {
                  setCode(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void verifyCode();
                }}
              />

              <Button fullWidth size="lg" loading={checking} onClick={verifyCode}>
                Verify
              </Button>
            </div>
          )}

          {step === "profile" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
                  Your profile
                </h2>
                <p className="mt-0.5 text-[13px] leading-[18px] text-secondary">
                  This is what other people see.
                </p>
              </div>

              <div className="flex justify-center">
                <Avatar
                  name={displayName || "?"}
                  color={color}
                  size={80}
                />
              </div>

              <Input
                name="display-name"
                label="Display name"
                placeholder="Your name"
                value={displayName}
                maxLength={128}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setError(null);
                }}
              />

              <div>
                <p className="pb-2 text-[13px] font-medium text-secondary">
                  Avatar colour
                </p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CONVERSATION_COLORS) as AvatarColor[]).map(
                    (name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setColor(name)}
                        aria-label={name}
                        aria-pressed={color === name}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full",
                          color === name &&
                            "ring-2 ring-ultramarine ring-offset-2 ring-offset-[var(--surface-raised)]",
                        )}
                        style={{ backgroundColor: CONVERSATION_COLORS[name] }}
                      >
                        {color === name && (
                          <CheckIcon
                            size={14}
                            className="text-white"
                            strokeWidth={3}
                          />
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <Input
                name="new-password"
                label="Password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                autoComplete="new-password"
                error={error}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void finish();
                }}
              />

              <Button fullWidth size="lg" loading={busy} onClick={finish}>
                Create account
              </Button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] leading-[15px] text-tertiary">
          A Signal clone built for an assignment. Encryption is simulated and
          messages are stored in plain text.
        </p>
      </div>
    </main>
  );
}

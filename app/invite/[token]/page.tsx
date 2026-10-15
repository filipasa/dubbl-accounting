"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle, Users, Mail, AlertTriangle, ArrowRight, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";

type State = "loading" | "ready" | "accepting" | "success" | "error";

interface InviteInfo {
  orgName: string;
  role: string;
  inviterName: string;
  type: "email" | "link";
  email?: string;
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const [state, setState] = useState<State>("loading");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Determine if this is an email invite token (64 chars hex) or link token (32 chars hex)
  const isLinkToken = (token || "").length === 32;

  useEffect(() => {
    async function loadInfo() {
      if (!token) return;
      try {
        if (isLinkToken) {
          const res = await fetch(`/api/v1/invite-links/info?token=${token}`);
          if (res.ok) {
            const data = await res.json();
            setInfo({
              orgName: data.orgName,
              role: data.defaultRole,
              inviterName: "",
              type: "link",
            });
            setState("ready");
          } else {
            const data = await res.json().catch(() => ({}));
            setError(data.error || "Invalid or expired invite link");
            setState("error");
          }
        } else {
          const res = await fetch(`/api/v1/invitations/info?token=${token}`);
          if (res.ok) {
            const data = await res.json();
            setInfo({
              orgName: data.orgName,
              role: data.role,
              inviterName: data.inviterName,
              type: "email",
              email: data.email,
            });
            setState("ready");
          } else {
            const data = await res.json().catch(() => ({}));
            setError(data.error || "Invalid or expired invitation");
            setState("error");
          }
        }
      } catch {
        setError("Failed to load invitation. Please check your internet connection.");
        setState("error");
      }
    }
    loadInfo();
  }, [token, isLinkToken]);

  async function handleAccept() {
    setState("accepting");
    try {
      const endpoint = isLinkToken ? "/api/v1/invite-links/join" : "/api/v1/invitations/accept";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to accept invitation");
        setState("error");
        return;
      }
      setOrgId(data.organizationId);
      if (data.organizationId) {
        localStorage.setItem("activeOrgId", data.organizationId);
      }
      setState("success");
    } catch {
      setError("Something went wrong while accepting the invitation.");
      setState("error");
    }
  }

  function goToDashboard() {
    if (orgId) {
      localStorage.setItem("activeOrgId", orgId);
    }
    window.location.href = "/dashboard";
  }

  async function handleSwitchAccount() {
    await signOut({ redirect: false });
    const callbackUrl = `/invite/${token}`;
    const target = info?.email
      ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}&email=${encodeURIComponent(info.email)}`
      : `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    router.push(target);
  }

  const isLoggedIn = !!session?.user;
  const userEmail = session?.user?.email?.toLowerCase() || "";
  const inviteEmail = info?.email?.toLowerCase() || "";
  const isEmailMismatch = Boolean(isLoggedIn && inviteEmail && userEmail && inviteEmail !== userEmail);

  const inviteCallbackUrl = `/invite/${token}`;
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(inviteCallbackUrl)}${info?.email ? `&email=${encodeURIComponent(info.email)}` : ""}`;
  const signUpUrl = `/sign-up?callbackUrl=${encodeURIComponent(inviteCallbackUrl)}${info?.email ? `&email=${encodeURIComponent(info.email)}` : ""}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <Logo className="h-7 w-9" />
            <span className="text-lg font-bold tracking-tight text-emerald-600">fixbooks</span>
          </div>

          {state === "loading" && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="mt-4 text-sm text-muted-foreground">Loading invitation...</p>
            </div>
          )}

          {state === "ready" && info && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Join {info.orgName}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {info.type === "email" && info.inviterName
                    ? `${info.inviterName} invited you to join as a `
                    : "You've been invited to join as a "}
                  <span className="font-medium text-foreground">{info.role}</span>.
                </p>
              </div>

              {/* Organization and Role details badge */}
              <div className="rounded-lg bg-muted/50 p-4 flex items-center gap-3 border border-border">
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/50">
                  <Users className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">{info.orgName}</p>
                  <p className="text-xs text-muted-foreground capitalize">Role: {info.role}</p>
                </div>
              </div>

              {/* Case 1: Not logged in */}
              {!isLoggedIn && authStatus !== "loading" && (
                <div className="space-y-4">
                  {info.email && (
                    <div className="flex items-center gap-2 rounded-lg bg-blue-50/70 p-3 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                      <Mail className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span>
                        Invitation sent to <strong className="font-semibold">{info.email}</strong>
                      </span>
                    </div>
                  )}

                  <div className="space-y-2.5 pt-2">
                    <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700" size="lg">
                      <Link href={signInUrl}>
                        <LogIn className="size-4 mr-2" />
                        Sign in to Accept
                      </Link>
                    </Button>

                    <Button asChild variant="outline" className="w-full" size="lg">
                      <Link href={signUpUrl}>
                        <UserPlus className="size-4 mr-2" />
                        Create Account to Accept
                      </Link>
                    </Button>
                  </div>

                  <p className="text-center text-xs text-muted-foreground">
                    Sign in or register with <span className="font-medium text-foreground">{info.email || "your invited email"}</span> to join.
                  </p>
                </div>
              )}

              {/* Case 2: Logged in, but with an email mismatch */}
              {isLoggedIn && isEmailMismatch && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 space-y-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      Different account detected
                    </div>
                    <p className="leading-relaxed">
                      This invitation was sent to <strong className="font-semibold">{info.email}</strong>, but you are currently signed in as <strong className="font-semibold">{session?.user?.email}</strong>.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <Button
                      onClick={handleSwitchAccount}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      size="lg"
                    >
                      <LogIn className="size-4 mr-2" />
                      Sign in as {info.email}
                    </Button>
                    <Button
                      onClick={handleSwitchAccount}
                      variant="outline"
                      className="w-full"
                    >
                      Switch Account
                    </Button>
                  </div>
                </div>
              )}

              {/* Case 3: Logged in with matching email (or link token) */}
              {isLoggedIn && !isEmailMismatch && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-md border border-border">
                    <span>
                      Signed in as <strong className="text-foreground">{session?.user?.email}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleSwitchAccount}
                      className="text-emerald-600 hover:text-emerald-500 font-medium underline-offset-2 hover:underline"
                    >
                      Switch
                    </button>
                  </div>

                  <Button
                    onClick={handleAccept}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    size="lg"
                  >
                    Accept Invitation
                    <ArrowRight className="size-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {state === "accepting" && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="size-8 text-emerald-600 animate-spin" />
              <p className="mt-4 text-sm font-medium text-foreground">Joining organization...</p>
              <p className="mt-1 text-xs text-muted-foreground">Setting up your team workspace</p>
            </div>
          )}

          {state === "success" && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
                  <CheckCircle2 className="size-6 text-emerald-600" />
                </div>
                <h1 className="mt-4 text-xl font-semibold text-foreground">You&apos;re in!</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  You have successfully joined <span className="font-medium text-foreground">{info?.orgName || "the organization"}</span>.
                </p>
              </div>
              <Button
                onClick={goToDashboard}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                size="lg"
              >
                Go to Dashboard
                <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          )}

          {state === "error" && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
                  <XCircle className="size-6 text-red-600" />
                </div>
                <h1 className="mt-4 text-xl font-semibold text-foreground">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => router.push("/")}>
                  Go Home
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => router.push("/sign-in")}>
                  Sign In
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Landmark,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  RefreshCw,
  PlusCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { loadStripe } from "@stripe/stripe-js";
import { formatMoney } from "@/lib/money";

interface BankAccountOption {
  id: string;
  accountName: string;
  accountNumber?: string | null;
  bankName?: string | null;
  currencyCode: string;
}

interface DiscoveredAccount {
  stripeAccountId: string;
  institutionName: string;
  displayName: string;
  last4: string | null;
  currency: string;
  category: string;
  subcategory: string;
  balanceCents: number;
  status: string;
}

interface AccountMappingSelection {
  stripeAccountId: string;
  institutionName: string;
  displayName: string;
  last4: string | null;
  currency: string;
  category: string;
  subcategory: string;
  action: "link_existing" | "create_new" | "skip";
  existingBankAccountId?: string;
  newAccountName?: string;
}

interface ConnectBankFeedDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingAccounts: BankAccountOption[];
  preselectedBankAccountId?: string;
  onSuccess?: () => void;
}

const PRESET_DAYS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "1 year", days: 365 },
  { label: "2 years", days: 730 },
];

export function ConnectBankFeedDialog({
  isOpen,
  onClose,
  existingAccounts,
  preselectedBankAccountId,
  onSuccess,
}: ConnectBankFeedDialogProps) {
  const [step, setStep] = useState<"configure" | "connecting" | "mapping" | "syncing" | "complete">("configure");
  const [selectedDays, setSelectedDays] = useState<number>(90);
  const [isCustomDate, setIsCustomDate] = useState(false);

  // Compute boundaries for 730 days (2 years)
  const todayStr = new Date().toISOString().slice(0, 10);
  const minDateStr = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [customStartDate, setCustomStartDate] = useState<string>(
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [discoveredAccounts, setDiscoveredAccounts] = useState<DiscoveredAccount[]>([]);
  const [accountMappings, setAccountMappings] = useState<Record<string, AccountMappingSelection>>({});
  const [syncSummary, setSyncSummary] = useState<{ totalSynced: number; totalAccounts: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const customDateInputId = useId();

  // Reset modal state
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setStep("configure");
      setErrorMsg(null);
      setLoading(false);
      onClose();
    }
  };

  // Launch Stripe Financial Connections Session
  const handleStartConnection = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStep("connecting");

    try {
      const payload: { days?: number; startDate?: string } = {};
      if (isCustomDate) {
        payload.startDate = customStartDate;
      } else {
        payload.days = selectedDays;
      }

      const res = await fetch("/api/v1/integrations/stripe-financial-connections/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to initialize bank feed session");
      }

      const sessionData = await res.json();
      setActiveSessionId(sessionData.sessionId);

      // Launch Stripe client-side modal
      if (!sessionData.publishableKey || !sessionData.clientSecret) {
        throw new Error(
          "Stripe credentials missing. Ensure STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are configured."
        );
      }

      const stripe = await loadStripe(sessionData.publishableKey);
      if (!stripe) {
        throw new Error("Unable to initialize Stripe.js. Please check your network connection.");
      }

      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: sessionData.clientSecret,
      });

      if (result.error) {
        throw new Error(result.error.message || "Bank connection cancelled or failed.");
      }

      // Retrieve discovered accounts
      const accountsRes = await fetch(
        `/api/v1/integrations/stripe-financial-connections/session/${sessionData.sessionId}`
      );
      if (!accountsRes.ok) {
        throw new Error("Failed to retrieve connected bank accounts.");
      }

      const accountsData = await accountsRes.json();
      const accounts: DiscoveredAccount[] = accountsData.accounts || [];

      if (accounts.length === 0) {
        throw new Error("No accounts were authorized during the connection.");
      }

      setDiscoveredAccounts(accounts);

      // Initialize default mappings
      const initialMappings: Record<string, AccountMappingSelection> = {};
      for (const [idx, acc] of accounts.entries()) {
        // Find matching existing account by currency or name
        const match = existingAccounts.find(
          (ea) =>
            ea.currencyCode.toUpperCase() === acc.currency.toUpperCase() &&
            (ea.accountNumber?.includes(acc.last4 || "") ||
              ea.accountName.toLowerCase().includes(acc.institutionName.toLowerCase()))
        );

        const targetExistingId =
          (preselectedBankAccountId && idx === 0 ? preselectedBankAccountId : undefined) ||
          match?.id;

        initialMappings[acc.stripeAccountId] = {
          stripeAccountId: acc.stripeAccountId,
          institutionName: acc.institutionName,
          displayName: acc.displayName,
          last4: acc.last4,
          currency: acc.currency,
          category: acc.category,
          subcategory: acc.subcategory,
          action: targetExistingId ? "link_existing" : "create_new",
          existingBankAccountId: targetExistingId,
          newAccountName: `${acc.institutionName} ${acc.displayName}`,
        };
      }

      setAccountMappings(initialMappings);
      setStep("mapping");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      toast.error(msg);
      setStep("configure");
    } finally {
      setLoading(false);
    }
  };

  // Complete Account Mapping and Initial Sync
  const handleConfirmMapping = async () => {
    if (!activeSessionId) return;

    setLoading(true);
    setStep("syncing");
    setErrorMsg(null);

    try {
      const mappingsList = Object.values(accountMappings);

      const res = await fetch("/api/v1/integrations/stripe-financial-connections/link-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          accounts: mappingsList,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to link accounts");
      }

      const data = await res.json();
      const linked = data.linkedAccounts || [];

      let totalSynced = 0;
      for (const item of linked) {
        totalSynced += item.syncResult?.synced || 0;
      }

      setSyncSummary({
        totalSynced,
        totalAccounts: linked.length,
      });

      toast.success(
        `Successfully linked ${linked.length} account(s) and synced ${totalSynced} transaction(s)!`
      );
      setStep("complete");
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      toast.error(msg);
      setStep("mapping");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <Landmark className="size-4" />
            </div>
            <DialogTitle className="text-base font-semibold">
              {step === "complete"
                ? "Bank Feed Connected"
                : step === "mapping"
                ? "Map Bank Accounts"
                : "Connect Bank Feed (Stripe)"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === "complete"
              ? "Your bank feed is active. Transactions and balances will sync automatically."
              : step === "mapping"
              ? "Select which bank accounts to import and link into Fixbooks."
              : "Securely link your bank account via Stripe Financial Connections to sync live balances and transactions."}
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMsg}</div>
          </div>
        )}

        {/* STEP 1: CONFIGURE HISTORICAL WINDOW */}
        {step === "configure" && (
          <div className="space-y-5 py-2">
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Historical Sync Window
                </Label>
                <Badge variant="outline" className="text-[10px] font-mono">
                  Max 730 days (2 years)
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose how far back to import past transactions from your bank.
              </p>

              {/* Quick Presets */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                {PRESET_DAYS.map((preset) => (
                  <Button
                    key={preset.days}
                    type="button"
                    variant={!isCustomDate && selectedDays === preset.days ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => {
                      setIsCustomDate(false);
                      setSelectedDays(preset.days);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>

              {/* Custom Date Picker option */}
              <div className="pt-2 border-t border-border/60">
                <button
                  type="button"
                  className="flex items-center justify-between w-full text-xs font-medium text-left hover:text-foreground"
                  onClick={() => setIsCustomDate(!isCustomDate)}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={isCustomDate ? "text-emerald-600 font-semibold" : "text-muted-foreground"}>
                      • Or pick a custom start date
                    </span>
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {isCustomDate ? "Active" : "Select date"}
                  </Badge>
                </button>

                {isCustomDate && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1">
                      <Label htmlFor={customDateInputId} className="text-[11px] text-muted-foreground block mb-1">
                        Import transactions starting from:
                      </Label>
                      <Input
                        id={customDateInputId}
                        type="date"
                        min={minDateStr}
                        max={todayStr}
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Trust badge */}
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                FCA & Open Banking compliant via Stripe. Your credentials are never stored by Fixbooks.
              </span>
            </div>
          </div>
        )}

        {/* STEP 2: CONNECTING / LOADING */}
        {step === "connecting" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
            <Loader2 className="size-8 animate-spin text-emerald-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Opening secure bank portal...</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Complete the authorization in the Stripe dialog to connect your bank account.
              </p>
            </div>
          </div>
        )}

        {/* STEP 3: MAPPING ACCOUNTS */}
        {step === "mapping" && (
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">
              We found {discoveredAccounts.length} account(s). Choose how each should be handled:
            </p>

            <div className="space-y-3">
              {discoveredAccounts.map((acc) => {
                const current = accountMappings[acc.stripeAccountId] || {
                  action: "create_new",
                };

                return (
                  <div
                    key={acc.stripeAccountId}
                    className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                          <h4 className="text-sm font-semibold">{acc.institutionName}</h4>
                          {acc.last4 && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              ···{acc.last4}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{acc.displayName}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold">
                          {formatMoney(acc.balanceCents, acc.currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">{acc.currency}</p>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-border/60">
                      <Label className="text-[11px] text-muted-foreground">Action in Fixbooks:</Label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          type="button"
                          variant={current.action === "link_existing" ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs"
                          disabled={existingAccounts.length === 0}
                          onClick={() =>
                            setAccountMappings((prev) => ({
                              ...prev,
                              [acc.stripeAccountId]: {
                                ...prev[acc.stripeAccountId],
                                action: "link_existing",
                                existingBankAccountId:
                                  prev[acc.stripeAccountId]?.existingBankAccountId || existingAccounts[0]?.id,
                              },
                            }))
                          }
                        >
                          Link existing
                        </Button>
                        <Button
                          type="button"
                          variant={current.action === "create_new" ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setAccountMappings((prev) => ({
                              ...prev,
                              [acc.stripeAccountId]: {
                                ...prev[acc.stripeAccountId],
                                action: "create_new",
                              },
                            }))
                          }
                        >
                          Create new
                        </Button>
                        <Button
                          type="button"
                          variant={current.action === "skip" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() =>
                            setAccountMappings((prev) => ({
                              ...prev,
                              [acc.stripeAccountId]: {
                                ...prev[acc.stripeAccountId],
                                action: "skip",
                              },
                            }))
                          }
                        >
                          Skip
                        </Button>
                      </div>

                      {/* Dropdown if link existing */}
                      {current.action === "link_existing" && (
                        <div className="mt-2">
                          <select
                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={current.existingBankAccountId || ""}
                            onChange={(e) =>
                              setAccountMappings((prev) => ({
                                ...prev,
                                [acc.stripeAccountId]: {
                                  ...prev[acc.stripeAccountId],
                                  existingBankAccountId: e.target.value,
                                },
                              }))
                            }
                          >
                            {existingAccounts.map((ea) => (
                              <option key={ea.id} value={ea.id}>
                                {ea.accountName} ({ea.currencyCode}) {ea.accountNumber ? `···${ea.accountNumber}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Input if create new */}
                      {current.action === "create_new" && (
                        <div className="mt-2">
                          <Input
                            className="h-8 text-xs"
                            placeholder="New account name in Fixbooks"
                            value={current.newAccountName || ""}
                            onChange={(e) =>
                              setAccountMappings((prev) => ({
                                ...prev,
                                [acc.stripeAccountId]: {
                                  ...prev[acc.stripeAccountId],
                                  newAccountName: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 4: SYNCING IN PROGRESS */}
        {step === "syncing" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
            <RefreshCw className="size-8 animate-spin text-emerald-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Linking accounts & importing transactions...</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Please wait while we deduplicate transactions and update your balances.
              </p>
            </div>
          </div>
        )}

        {/* STEP 5: COMPLETED */}
        {step === "complete" && (
          <div className="py-6 text-center space-y-4">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CheckCircle2 className="size-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Bank Feed Successfully Connected!</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Imported {syncSummary?.totalSynced || 0} historical transactions across {syncSummary?.totalAccounts || 0} account(s).
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="pt-2">
          {step === "configure" && (
            <div className="flex w-full items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                onClick={handleStartConnection}
                disabled={loading}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Connect with Bank
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          )}

          {step === "mapping" && (
            <div className="flex w-full items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("configure")}>
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                onClick={handleConfirmMapping}
                disabled={loading}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save & Start Syncing
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          )}

          {step === "complete" && (
            <Button
              type="button"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                onClose();
                window.location.reload();
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

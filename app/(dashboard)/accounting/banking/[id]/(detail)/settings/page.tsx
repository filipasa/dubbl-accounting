"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountPicker } from "@/components/dashboard/account-picker";
import { ConnectBankFeedDialog } from "@/components/dashboard/connect-bank-feed-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencySelect } from "@/components/ui/currency-select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { getCurrencySymbol } from "@/lib/currency/iso4217";
import { RefreshCw, Landmark } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/lib/hooks/use-confirm";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/hooks/use-document-title";
import { useBankAccountContext } from "../layout";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_COLORS, type BankAccountFeed } from "../../_components";

export default function BankSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { account, setAccount, refetch } = useBankAccountContext();
  const [saving, setSaving] = useState(false);
  const [syncingBalance, setSyncingBalance] = useState(false);
  const [bankCurrency, setBankCurrency] = useState(account?.currencyCode || "USD");
  const [balanceStr, setBalanceStr] = useState(
    account?.balance != null ? (account.balance / 100).toFixed(2) : "0.00"
  );
  // Which ledger account this bank account is recorded under. Defaults to the
  // one connected automatically; the picker lets the user point it elsewhere.
  const [chartAccountId, setChartAccountId] = useState(account?.chartAccountId ?? "");
  const [feed, setFeed] = useState<BankAccountFeed | null>(account?.feed || null);
  const [syncingFeed, setSyncingFeed] = useState(false);
  const [connectFeedOpen, setConnectFeedOpen] = useState(false);

  const orgId = typeof window !== "undefined" ? localStorage.getItem("activeOrgId") : null;

  useDocumentTitle("Accounting · Bank Settings");

  useEffect(() => {
    if (account?.feed !== undefined) {
      setFeed(account.feed);
    }
    if (!orgId) return;
    fetch(`/api/v1/bank-accounts/${id}/feed`, {
      headers: { "x-organization-id": orgId },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.feed !== undefined) {
          setFeed(data.feed);
        }
      })
      .catch(() => {});
  }, [id, orgId, account?.feed]);

  useEffect(() => {
    if (account?.currencyCode) {
      setBankCurrency(account.currencyCode);
    }
    if (account?.balance != null) {
      setBalanceStr((account.balance / 100).toFixed(2));
    }
  }, [account?.balance, account?.currencyCode]);

  async function handleSyncBalance() {
    if (!orgId) return;
    setSyncingBalance(true);
    try {
      const res = await fetch(`/api/v1/bank-accounts/${id}/sync-balance`, {
        method: "POST",
        headers: { "x-organization-id": orgId },
      });
      if (!res.ok) throw new Error("Failed to sync balance");
      const data = await res.json();
      if (data.success && data.balance != null) {
        setBalanceStr((data.balance / 100).toFixed(2));
        setAccount((prev) => (prev ? { ...prev, balance: data.balance } : prev));
        refetch();
        toast.success(
          data.message || `Balance synced to ${(data.balance / 100).toFixed(2)}`
        );
      } else {
        toast.info(
          data.message || "No running balance column found in imported statements."
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync balance");
    } finally {
      setSyncingBalance(false);
    }
  }

  async function handleSyncFeed() {
    if (!orgId) return;
    setSyncingFeed(true);
    try {
      const res = await fetch("/api/v1/integrations/stripe-financial-connections/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({ bankAccountId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync bank feed");
      toast.success(
        `Bank feed synced! ${data.result?.syncedCount ?? 0} new transaction(s) imported.`
      );
      refetch();
      const feedRes = await fetch(`/api/v1/bank-accounts/${id}/feed`, {
        headers: { "x-organization-id": orgId },
      });
      const feedData = await feedRes.json();
      if (feedData.feed !== undefined) setFeed(feedData.feed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync bank feed");
    } finally {
      setSyncingFeed(false);
    }
  }

  async function handleDisconnectFeed() {
    if (!orgId) return;
    await confirm({
      title: "Disconnect bank feed?",
      description:
        "This will unlink the Stripe Financial Connections feed from this account. Previously imported transactions will not be deleted.",
      confirmLabel: "Disconnect Feed",
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/v1/bank-accounts/${id}/feed`, {
            method: "DELETE",
            headers: { "x-organization-id": orgId },
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Failed to disconnect feed");
          }
          toast.success("Bank feed disconnected");
          setFeed(null);
          refetch();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to disconnect feed");
        }
      },
    });
  }

  async function handleSaveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const parsedBalance =
      balanceStr !== "" ? Math.round(parseFloat(balanceStr) * 100) : 0;

    try {
      const res = await fetch(`/api/v1/bank-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify({
          accountName: fd.get("accountName"),
          bankName: fd.get("bankName") || null,
          accountNumber: fd.get("accountNumber") || null,
          currencyCode: bankCurrency || undefined,
          countryCode: fd.get("countryCode") || null,
          accountType: fd.get("accountType") || undefined,
          color: fd.get("color") || undefined,
          balance: isNaN(parsedBalance) ? 0 : parsedBalance,
          // Only send a connection when one is chosen — never actively unlink
          // (an empty value just falls back to the automatic connection).
          ...(chartAccountId ? { chartAccountId } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setAccount(() => data.bankAccount);
      toast.success("Account updated");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!orgId) return;
    await confirm({
      title: "Delete this bank account?",
      description: "This will permanently delete the account and all its transactions. This cannot be undone.",
      confirmLabel: "Delete Account",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/v1/bank-accounts/${id}`, {
          method: "DELETE",
          headers: { "x-organization-id": orgId },
        });
        if (res.ok) {
          toast.success("Account deleted");
          router.push("/accounting/banking");
        } else {
          toast.error("Failed to delete account");
        }
      },
    });
  }

  return (
    <>
      <form onSubmit={handleSaveSettings} className="space-y-10">
        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">General</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Account name, bank, and type.</p>
          </div>
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Account Name</Label>
              <Input name="accountName" required defaultValue={account.accountName} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Bank Name</Label>
                <Input name="bankName" defaultValue={account.bankName || ""} placeholder="e.g. Revolut Business" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Account Type</Label>
                <Select name="accountType" defaultValue={account.accountType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account Number / IBAN</Label>
              <Input name="accountNumber" defaultValue={account.accountNumber || ""} placeholder="1234 or GB29NWBK..." />
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">Bank Feed</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Automate transaction ingestion via Stripe Financial Connections.
            </p>
          </div>
          <div className="min-w-0">
            {feed && feed.status === "active" ? (
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                      <Landmark className="size-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{feed.institutionName}</p>
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] gap-1">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Connected
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {feed.displayName} {feed.last4 ? `(····${feed.last4})` : ""} · {feed.currency}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSyncFeed}
                      loading={syncingFeed}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw className={cn("size-3.5", syncingFeed && "animate-spin")} />
                      Sync Now
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDisconnectFeed}
                      className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-2 border-t">
                  <span>
                    Last synced:{" "}
                    <strong className="text-foreground font-medium">
                      {feed.lastSyncAt ? new Date(feed.lastSyncAt).toLocaleString() : "Never"}
                    </strong>
                  </span>
                  {feed.lastSyncTxnCount != null && (
                    <span>
                      Transactions imported in last sync:{" "}
                      <strong className="text-foreground font-medium">{feed.lastSyncTxnCount}</strong>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-5 space-y-3 bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0 mt-0.5">
                    <Landmark className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No live bank feed connected</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Connect your bank via Stripe Financial Connections to automatically stream transactions and keep your balance up to date with zero manual exports.
                    </p>
                  </div>
                </div>
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConnectFeedOpen(true)}
                    className="border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-950/40 text-xs"
                  >
                    <Landmark className="mr-2 size-3.5 text-emerald-600 dark:text-emerald-400" />
                    Connect Bank Feed
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">Statement Balance</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Current closing balance shown on your bank statement.
            </p>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-full sm:w-56">
                <CurrencyInput
                  prefix={getCurrencySymbol(bankCurrency)}
                  value={balanceStr}
                  onChange={setBalanceStr}
                  placeholder="0.00"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSyncBalance}
                loading={syncingBalance}
                className="gap-1.5 text-xs shrink-0 self-start sm:self-auto"
              >
                <RefreshCw className={cn("size-3.5", syncingBalance && "animate-spin")} />
                Sync from statement
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              If your bank statement CSV included a running balance column, clicking &ldquo;Sync from statement&rdquo; auto-detects your latest balance. For statements without balance columns (such as Barclays or Tide), you can manually enter your closing balance here.
            </p>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">Region</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Currency and country for this account.</p>
          </div>
          <div className="min-w-0 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <CurrencySelect value={bankCurrency} onValueChange={setBankCurrency} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Country</Label>
              <Input name="countryCode" defaultValue={account.countryCode || ""} placeholder="US" maxLength={2} />
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">Books connection</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              The account in your books where this bank account&apos;s money is recorded. We set one up automatically &mdash; change it only if you want to use a specific account you already have.
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <AccountPicker
              value={chartAccountId}
              onChange={setChartAccountId}
              typeFilter={["asset", "liability"]}
              placeholder="Connect to an account in your books…"
              allowCreate
            />
            <p className="text-[11px] text-muted-foreground">
              Changing this only affects transactions recorded from now on.
            </p>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium">Accent Color</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Color used on cards and charts.</p>
          </div>
          <div className="min-w-0">
            <input type="hidden" name="color" value={account.color} />
            <div className="flex gap-2">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccount((prev) => prev ? { ...prev, color: c } : prev)}
                  className={cn(
                    "size-6 rounded-full ring-2 ring-transparent transition-all",
                    account.color === c && "ring-offset-2 ring-gray-400"
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Choose ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={saving} className="bg-emerald-600 hover:bg-emerald-700">
            Save changes
          </Button>
        </div>

        <div className="h-px bg-border" />

        <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-10">
          <div className="shrink-0">
            <p className="text-sm font-medium text-red-600">Danger zone</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Irreversible actions.</p>
          </div>
          <div className="min-w-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Delete account</p>
                <p className="text-[12px] text-muted-foreground">Permanently delete this account and all imported transactions.</p>
              </div>
              <Button variant="destructive" size="sm" type="button" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </div>
      </form>

      <ConnectBankFeedDialog
        isOpen={connectFeedOpen}
        onClose={() => setConnectFeedOpen(false)}
        existingAccounts={[
          {
            id: account.id,
            accountName: account.accountName,
            accountNumber: account.accountNumber,
            bankName: account.bankName,
            currencyCode: account.currencyCode,
          },
        ]}
        preselectedBankAccountId={account.id}
        onSuccess={() => {
          refetch();
          if (orgId) {
            fetch(`/api/v1/bank-accounts/${id}/feed`, {
              headers: { "x-organization-id": orgId },
            })
              .then((res) => res.json())
              .then((data) => {
                if (data.feed !== undefined) setFeed(data.feed);
              });
          }
        }}
      />

      {confirmDialog}
    </>
  );
}

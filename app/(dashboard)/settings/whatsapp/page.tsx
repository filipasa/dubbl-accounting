"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Send,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  QrCode,
  FileText,
  Sparkles,
  Search,
  Landmark,
  ChevronDown,
  ChevronUp,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface StatusResponse {
  isConfigured: boolean;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessProfile?: {
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
  } | null;
  verifyToken: string;
  webhookUrl: string;
  allowedNumbers: string[];
  hasAccessToken: boolean;
  hasPhoneNumberId: boolean;
  hasAppSecret: boolean;
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  recentLogs: Array<{
    id: string;
    messageId: string | null;
    senderPhone: string;
    recipientPhone: string | null;
    direction: string;
    messageBody: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
}

export default function WhatsAppSettingsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Test message state
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/whatsapp/status");
      if (!res.ok) throw new Error("Failed to load WhatsApp integration status");
      const data = await res.json();
      setStatus(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`Copied ${field} to clipboard`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const copyPrompt = (promptText: string) => {
    navigator.clipboard.writeText(promptText);
    toast.success("Prompt copied! Paste it into WhatsApp.");
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      toast.error("Please enter a phone number with country code (e.g. 447950869980)");
      return;
    }

    setSendingTest(true);
    try {
      const res = await fetch("/api/v1/integrations/whatsapp/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: testPhone,
          message: testMessage || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      toast.success("Test WhatsApp message sent successfully!");
      setTestMessage("");
      fetchStatus();
    } catch (err: any) {
      toast.error(err.message || "Error sending test message");
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isConnected = Boolean(status?.isConfigured);
  const displayPhone =
    status?.displayPhoneNumber ||
    status?.businessProfile?.displayPhoneNumber ||
    (status?.phoneNumberId ? "Connected" : null);

  // Clean numerical phone for wa.me links
  const rawCleanPhone = displayPhone ? displayPhone.replace(/[^0-9]/g, "") : "";
  const waChatLink = rawCleanPhone
    ? `https://wa.me/${rawCleanPhone}?text=Hi%20Fixbooks`
    : null;

  return (
    <div className="space-y-8 max-w-5xl pb-16">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                WhatsApp Assistant
              </h1>
              <p className="text-sm text-muted-foreground">
                Official Meta WhatsApp Cloud API integration for serverless bookkeeping and invoicing.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isConnected ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300 dark:border-emerald-800 gap-1.5 px-3 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected &amp; Active
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1.5 px-3 py-1">
              <XCircle className="h-3.5 w-3.5" /> Setup Required
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              fetchStatus();
            }}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Hero Quick Launch Card */}
      <Card className="border-border shadow-sm overflow-hidden bg-gradient-to-br from-card via-card to-emerald-500/5">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/25">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    {status?.businessProfile?.verifiedName || "Fixbooks WhatsApp Assistant"}
                    {displayPhone && (
                      <span className="text-sm font-normal text-muted-foreground font-mono">
                        ({displayPhone})
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Meta Cloud API connected &amp; ready
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                Send voice notes, text messages, or photos of bills directly to Fixbooks on WhatsApp. Our assistant automatically extracts line items, creates quotes, drafts invoices, and provides instant financial updates.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {waChatLink ? (
                  <Button asChild size="lg" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                    <a href={waChatLink} target="_blank" rel="noreferrer">
                      <MessageSquare className="h-4 w-4" />
                      Chat on WhatsApp
                      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                    </a>
                  </Button>
                ) : (
                  <Button disabled size="lg" className="gap-2">
                    <Smartphone className="h-4 w-4" /> WhatsApp Connected
                  </Button>
                )}

                {waChatLink && (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setShowQr(!showQr)}
                    className="gap-2"
                  >
                    <QrCode className="h-4 w-4 text-emerald-600" />
                    {showQr ? "Hide QR Code" : "Scan on Mobile"}
                  </Button>
                )}
              </div>
            </div>

            {/* Mobile QR Code Popover */}
            {waChatLink && showQr && (
              <div className="flex flex-col items-center p-4 rounded-xl border bg-background shadow-sm text-center shrink-0 animate-in fade-in zoom-in-95 duration-200">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                    waChatLink
                  )}`}
                  alt="Scan to open WhatsApp chat"
                  className="rounded-lg h-40 w-40 bg-white p-1"
                />
                <span className="text-xs font-semibold text-foreground mt-2">
                  Scan with phone camera
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Opens directly in WhatsApp
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* What You Can Ask Feature Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            What You Can Ask Fixbooks on WhatsApp
          </h2>
          <p className="text-sm text-muted-foreground">
            Tap any prompt to copy it, or message Fixbooks naturally from your smartphone.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Invoices */}
          <div
            onClick={() => copyPrompt("Create invoice for Acme Corp for £850 for consulting services")}
            className="group p-4 rounded-xl border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer transition-all space-y-2 relative"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <FileText className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Instant Invoicing</span>
              </div>
              <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground">
              &ldquo;Create invoice for Acme Corp for £850 for consulting services&rdquo;
            </p>
            <div className="text-[11px] font-medium text-primary bg-primary/5 px-2 py-1 rounded w-fit">
              Fixbooks confirms customer, totals, and creates the invoice automatically.
            </div>
          </div>

          {/* Card 2: Quotes */}
          <div
            onClick={() => copyPrompt("Draft a quote for 20 hours website redesign for client Baker")}
            className="group p-4 rounded-xl border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer transition-all space-y-2 relative"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Estimates &amp; Quotes</span>
              </div>
              <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground">
              &ldquo;Draft a quote for 20 hours website redesign for client Baker&rdquo;
            </p>
            <div className="text-[11px] font-medium text-amber-600 bg-amber-500/10 px-2 py-1 rounded w-fit">
              Calculates line items and sends you the draft quote link instantly.
            </div>
          </div>

          {/* Card 3: Overdue & Invoices */}
          <div
            onClick={() => copyPrompt("Show me all unpaid invoices")}
            className="group p-4 rounded-xl border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer transition-all space-y-2 relative"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <Search className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Track Outstanding Debts</span>
              </div>
              <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground">
              &ldquo;Show me all unpaid invoices&rdquo;
            </p>
            <div className="text-[11px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded w-fit">
              Lists outstanding balances, client names, and overdue dates.
            </div>
          </div>

          {/* Card 4: Accounts & Organization */}
          <div
            onClick={() => copyPrompt("What's our company tax number and registered currency?")}
            className="group p-4 rounded-xl border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer transition-all space-y-2 relative"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
                  <Landmark className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm text-foreground">Company &amp; Bank Details</span>
              </div>
              <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground">
              &ldquo;What is our company VAT number and registered currency?&rdquo;
            </p>
            <div className="text-[11px] font-medium text-sky-600 bg-sky-500/10 px-2 py-1 rounded w-fit">
              Retrieves company profile, VAT details, and active bank accounts.
            </div>
          </div>
        </div>
      </div>

      {/* Recent Message Activity Log */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Message Activity Log</CardTitle>
                <CardDescription>
                  Audit log of recent bookkeeping requests and automated responses via WhatsApp.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {status?.recentLogs && status.recentLogs.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Direction</TableHead>
                    <TableHead className="w-36">Sender</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-36 text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge
                          variant={log.direction === "inbound" ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {log.direction === "inbound" ? "📥 Inbound" : "📤 Outbound"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.senderPhone || "—"}
                      </TableCell>
                      <TableCell className="max-w-md truncate text-xs">
                        {log.messageBody || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.status === "processed" || log.status === "sent"
                              ? "default"
                              : log.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-xs capitalize"
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No WhatsApp messages logged yet. Text your WhatsApp bot to see live logs!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced Connection & Developer Diagnostics (Collapsible) */}
      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="rounded-xl border bg-muted/20 overflow-hidden"
      >
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span>Advanced Connection &amp; Diagnostics</span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground uppercase ml-1">
                Developer
              </Badge>
            </div>
            {advancedOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="p-4 pt-0 space-y-5 border-t bg-card">
          <div className="text-xs text-muted-foreground pt-3">
            These technical connection parameters are for Meta Developer App configuration and diagnostic testing.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Callback URL
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={status?.webhookUrl || ""}
                  className="font-mono text-xs bg-muted/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(status?.webhookUrl || "", "Callback URL")}
                  className="shrink-0 gap-1.5"
                >
                  {copiedField === "Callback URL" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Verify Token
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={status?.verifyToken || ""}
                  className="font-mono text-xs bg-muted/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(status?.verifyToken || "", "Verify Token")}
                  className="shrink-0 gap-1.5"
                >
                  {copiedField === "Verify Token" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy
                </Button>
              </div>
            </div>
          </div>

          {/* Outbound Test Message Sender */}
          <div className="pt-2 border-t space-y-3">
            <span className="text-xs font-semibold text-foreground">
              Send Outbound Test WhatsApp Message
            </span>
            <form onSubmit={handleSendTestMessage} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="testPhone" className="text-xs">
                    Recipient Phone Number (with Country Code)
                  </Label>
                  <Input
                    id="testPhone"
                    placeholder="e.g. 447950869980 or 15551422502"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    disabled={sendingTest}
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="testMsg" className="text-xs">
                    Message Body (Optional)
                  </Label>
                  <Input
                    id="testMsg"
                    placeholder="Leave empty for default verification message"
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    disabled={sendingTest}
                    className="text-xs"
                  />
                </div>
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={sendingTest || !status?.hasAccessToken}
                className="gap-1.5 text-xs"
              >
                {sendingTest ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Sending via Meta Cloud API...
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Send Diagnostic Message
                  </>
                )}
              </Button>
            </form>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  MessageSquare,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Send,
  Loader2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Server,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

interface StatusResponse {
  isConfigured: boolean;
  phoneNumberId: string | null;
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
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isConnected = Boolean(status?.isConfigured);

  return (
    <div className="space-y-8 max-w-5xl pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                WhatsApp Bot
              </h1>
              <p className="text-sm text-muted-foreground">
                Official Meta WhatsApp Cloud API integration for serverless bookkeeping.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isConnected ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300 dark:border-emerald-800 gap-1.5 px-3 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected & Active
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-500/10 gap-1.5 px-3 py-1">
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

      {/* Meta Webhook Endpoint Card */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Meta Webhook Configuration</CardTitle>
          </div>
          <CardDescription>
            Enter these details in your Meta WhatsApp App Dashboard under{" "}
            <strong>WhatsApp &gt; Configuration &gt; Webhook</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhookUrl" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Callback URL
            </Label>
            <div className="flex gap-2">
              <Input
                id="webhookUrl"
                readOnly
                value={status?.webhookUrl || ""}
                className="font-mono text-sm bg-muted/50"
              />
              <Button
                variant="outline"
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
            <Label htmlFor="verifyToken" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Verify Token
            </Label>
            <div className="flex gap-2">
              <Input
                id="verifyToken"
                readOnly
                value={status?.verifyToken || ""}
                className="font-mono text-sm bg-muted/50"
              />
              <Button
                variant="outline"
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

          <div className="rounded-lg bg-blue-500/10 border border-blue-200 dark:border-blue-900/50 p-3 text-xs text-blue-800 dark:text-blue-300">
            <strong>Important:</strong> After saving the Callback URL and Verify Token in Meta, click{" "}
            <strong>Manage Webhook Fields</strong> and subscribe to <strong>messages</strong>.
          </div>
        </CardContent>
      </Card>

      {/* Environment Credentials Checklist */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Environment Variables</CardTitle>
          </div>
          <CardDescription>
            Configure these variables in your Vercel Project Settings &gt; Environment Variables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="space-y-0.5">
                <span className="font-mono text-xs font-semibold">WHATSAPP_ACCESS_TOKEN</span>
                <p className="text-xs text-muted-foreground">System User or App Access Token</p>
              </div>
              {status?.hasAccessToken ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300">
                  Configured
                </Badge>
              ) : (
                <Badge variant="destructive">Missing</Badge>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="space-y-0.5">
                <span className="font-mono text-xs font-semibold">WHATSAPP_PHONE_NUMBER_ID</span>
                <p className="text-xs text-muted-foreground">
                  {status?.phoneNumberId ? `ID: ${status.phoneNumberId}` : "From Meta WhatsApp API Setup"}
                </p>
              </div>
              {status?.hasPhoneNumberId ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300">
                  Configured
                </Badge>
              ) : (
                <Badge variant="destructive">Missing</Badge>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="space-y-0.5">
                <span className="font-mono text-xs font-semibold">WHATSAPP_APP_SECRET</span>
                <p className="text-xs text-muted-foreground">For HMAC-SHA256 signature validation</p>
              </div>
              {status?.hasAppSecret ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300">
                  Secured
                </Badge>
              ) : (
                <Badge variant="secondary">Optional</Badge>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="space-y-0.5">
                <span className="font-mono text-xs font-semibold">GEMINI_API_KEY</span>
                <p className="text-xs text-muted-foreground">Google AI for quote extraction & chat</p>
              </div>
              {status?.hasGeminiKey ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600">
                  Commands only
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Test Message Sender */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Send Test WhatsApp Message</CardTitle>
          </div>
          <CardDescription>
            Send a live verification message to confirm outbound Meta Cloud API connectivity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSendTestMessage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number (with Country Code)</Label>
                <Input
                  id="phone"
                  placeholder="e.g. 447950869980 or 15551234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  disabled={sendingTest}
                />
                <p className="text-xs text-muted-foreground">
                  Include international country code without spaces or leading + symbol.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="customMsg">Custom Message (Optional)</Label>
                <Input
                  id="customMsg"
                  placeholder="Leave empty for default greeting"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  disabled={sendingTest}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={sendingTest || !status?.hasAccessToken}
              className="gap-2"
            >
              {sendingTest ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending via Meta...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Test Message
                </>
              )}
            </Button>
            {!status?.hasAccessToken && (
              <p className="text-xs text-destructive">
                Configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID before sending test messages.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Recent Message Activity Log */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Message Activity Log</CardTitle>
                <CardDescription>
                  Audit log of recent inbound commands and automated outbound responses.
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
                    <TableHead className="w-36">Phone</TableHead>
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
                        +{log.senderPhone}
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
              No WhatsApp messages logged yet. Send a test message or text your bot to see live logs!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step by Step Meta Guide */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Quick Setup Guide</CardTitle>
          </div>
          <CardDescription>
            How to get Meta credentials in 3 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                1. Create Meta Developer App
              </span>
              <p>
                Go to{" "}
                <a
                  href="https://developers.facebook.com/apps/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  Meta Developer Portal <ExternalLink className="h-3 w-3" />
                </a>
                , create an app with type <strong>Other</strong> &gt; <strong>Business</strong>, and add the <strong>WhatsApp</strong> product.
              </p>
            </div>

            <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                2. Configure Webhook
              </span>
              <p>
                Under WhatsApp &gt; Configuration, click <strong>Edit</strong> on Webhook. Paste the Callback URL and Verify Token from above. Save and subscribe to <strong>messages</strong>.
              </p>
            </div>

            <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                3. Copy Phone Number ID & Token
              </span>
              <p>
                Go to WhatsApp &gt; API Setup. Copy your <strong>Phone Number ID</strong> and <strong>Temporary Access Token</strong> (or create a permanent System User token in Business Manager).
              </p>
            </div>

            <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                4. Add Vercel Environment Variables
              </span>
              <p>
                Set <code className="text-xs bg-muted px-1 py-0.5 rounded">WHATSAPP_ACCESS_TOKEN</code> and{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">WHATSAPP_PHONE_NUMBER_ID</code> on Vercel. That&apos;s it!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

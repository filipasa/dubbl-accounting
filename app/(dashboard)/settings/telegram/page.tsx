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
  Send,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Server,
  Bot,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface StatusResponse {
  isConfigured: boolean;
  botUser: {
    id: number;
    first_name: string;
    username?: string;
  } | null;
  webhookInfo: {
    url: string;
    pending_update_count: number;
    last_error_message?: string;
    last_error_date?: number;
  } | null;
  webhookUrl: string;
  secretToken: string;
  allowedUsers: string[];
  hasBotToken: boolean;
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  recentLogs: Array<{
    id: string;
    updateId: number | null;
    messageId: number | null;
    chatId: string;
    senderUsername: string | null;
    senderName: string | null;
    direction: string;
    messageBody: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }>;
}

export default function TelegramSettingsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Test message state
  const [testChatId, setTestChatId] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/telegram/status");
      if (!res.ok) throw new Error("Failed to load Telegram integration status");
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

  const handleRegisterWebhook = async () => {
    setRegisteringWebhook(true);
    try {
      const res = await fetch("/api/v1/integrations/telegram/setup-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register webhook");
      toast.success("Webhook registered successfully with Telegram!");
      fetchStatus();
    } catch (err: any) {
      toast.error(err.message || "Error registering webhook");
    } finally {
      setRegisteringWebhook(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId.trim()) {
      toast.error("Please enter a Chat ID (e.g. 123456789 or @channelusername)");
      return;
    }

    setSendingTest(true);
    try {
      const res = await fetch("/api/v1/integrations/telegram/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: testChatId,
          message: testMessage || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      toast.success("Test Telegram message sent successfully!");
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

  const isConnected = Boolean(status?.isConfigured && status?.botUser);
  const isWebhookActive = Boolean(
    status?.webhookInfo?.url && status?.webhookInfo?.url === status?.webhookUrl
  );

  // Extract unique recent chat IDs
  const recentChats = Array.from(
    new Map(
      (status?.recentLogs || [])
        .filter((l) => l.chatId)
        .map((l) => [
          l.chatId,
          { chatId: l.chatId, username: l.senderUsername, name: l.senderName },
        ])
    ).values()
  ).slice(0, 5);

  return (
    <div className="space-y-8 max-w-5xl pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Telegram Bot
                </h1>
                {status?.botUser?.username && (
                  <a
                    href={`https://t.me/${status.botUser.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline font-mono"
                  >
                    @{status.botUser.username} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Official Telegram Bot API integration for serverless bookkeeping and quote creation.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isConnected && isWebhookActive ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300 dark:border-emerald-800 gap-1.5 px-3 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Bot Connected & Active
            </Badge>
          ) : isConnected ? (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-500/10 gap-1.5 px-3 py-1">
              <Zap className="h-3.5 w-3.5" /> Register Webhook
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

      {/* Webhook Configuration & Auto-Register */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Telegram Webhook Registration</CardTitle>
            </div>
            <Button
              onClick={handleRegisterWebhook}
              disabled={registeringWebhook || !status?.hasBotToken}
              className="gap-2"
              size="sm"
            >
              {registeringWebhook ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" />
                  Register Webhook with Telegram
                </>
              )}
            </Button>
          </div>
          <CardDescription>
            Telegram delivers incoming updates to this URL. Click the button above to register automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhookUrl" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Webhook Callback URL
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
                onClick={() => copyToClipboard(status?.webhookUrl || "", "Webhook URL")}
                className="shrink-0 gap-1.5"
              >
                {copiedField === "Webhook URL" ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy
              </Button>
            </div>
          </div>

          <div className="p-3 rounded-lg border bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <span className="font-semibold text-foreground">Telegram Reported Status:</span>
              <p className="text-muted-foreground">
                {status?.webhookInfo?.url
                  ? `Active URL: ${status.webhookInfo.url}`
                  : "No webhook currently registered with Telegram."}
              </p>
              {status?.webhookInfo?.last_error_message && (
                <p className="text-destructive font-mono">
                  Error: {status.webhookInfo.last_error_message}
                </p>
              )}
            </div>
            {isWebhookActive ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300 w-fit">
                Webhook Synced
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-300 w-fit">
                Not Registered
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>



      {/* Live Test Message Sender */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Send Test Telegram Message</CardTitle>
          </div>
          <CardDescription>
            Send a live verification message to confirm outbound Telegram Bot API connectivity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Important Telegram Privacy Rule Banner */}
          <div className="rounded-lg bg-sky-500/10 border border-sky-200 dark:border-sky-900/50 p-4 text-xs text-sky-900 dark:text-sky-200 space-y-2">
            <div className="font-semibold flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm">
                <Bot className="h-4 w-4 text-sky-600" />
                Step 1: Start chat with your bot in Telegram
              </span>
              {status?.botUser?.username && (
                <a
                  href={`https://t.me/${status.botUser.username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600 text-white font-medium hover:bg-sky-700 transition-colors"
                >
                  Open @{status.botUser.username} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <p className="text-muted-foreground dark:text-sky-300">
              Telegram privacy rules prevent bots from initiating messages with users out of the blue. You must open your bot in Telegram and tap <strong>Start</strong> (or send <code>/start</code>). Once started, enter your Chat ID below or chat directly with the bot!
            </p>
          </div>

          <form onSubmit={handleSendTestMessage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="chatId">Telegram Chat ID</Label>
                <Input
                  id="chatId"
                  placeholder="e.g. 123456789 or @your_channel"
                  value={testChatId}
                  onChange={(e) => setTestChatId(e.target.value)}
                  disabled={sendingTest}
                />
                {recentChats.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 text-xs text-muted-foreground">
                    <span>Recent chats:</span>
                    {recentChats.map((c) => (
                      <button
                        key={c.chatId}
                        type="button"
                        onClick={() => setTestChatId(c.chatId)}
                        className="px-2 py-0.5 rounded border bg-background hover:bg-muted font-mono transition-colors text-foreground text-xs"
                      >
                        {c.username ? `@${c.username}` : c.chatId}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  To find your personal numeric ID, message <code>/start</code> to{" "}
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    @userinfobot
                  </a>
                  .
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
              disabled={sendingTest || !status?.hasBotToken}
              className="gap-2"
            >
              {sendingTest ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending via Telegram...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Test Message
                </>
              )}
            </Button>
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
                    <TableHead className="w-36">User / Chat</TableHead>
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
                        {log.senderUsername ? `@${log.senderUsername}` : log.chatId}
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
              <Bot className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No Telegram messages logged yet. Text your bot to see live logs!
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, Building2, Loader2, AlertCircle, Download, CreditCard } from "lucide-react";

function getLocaleForCurrency(currency: string): string {
  const map: Record<string, string> = {
    USD: "en-US", EUR: "de-DE", GBP: "en-GB", JPY: "ja-JP",
    AUD: "en-AU", CAD: "en-CA", CHF: "de-CH", SEK: "sv-SE",
    NOK: "nb-NO", DKK: "da-DK", NZD: "en-NZ", SGD: "en-SG",
    HKD: "en-HK", INR: "en-IN", BRL: "pt-BR", MXN: "es-MX",
  };
  return map[currency] || "en-GB";
}

function fmtMoney(cents: number, currency = "GBP") {
  return new Intl.NumberFormat(getLocaleForCurrency(currency), {
    style: "currency",
    currency,
  }).format(cents / 100);
}

interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxAmount: number;
  taxRate?: {
    id: string;
    name: string;
    rate: number;
  } | null;
}

interface InvoiceData {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal?: number;
  taxTotal?: number;
  total: number;
  amountPaid?: number;
  amountDue: number;
  currencyCode: string;
  lines: InvoiceLine[];
}

interface PaymentData {
  status: "pending" | "paid";
  paymentMethods?: string[];
  invoice: InvoiceData | { invoiceNumber: string };
  organization?: { name: string; logoUrl?: string | null };
  contact?: { name: string };
  error?: string;
}

function PaymentPageContent() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const urlStatus = searchParams.get("status");

  const [data, setData] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    async function fetchInvoice() {
      try {
        const res = await fetch(`/api/pay/${token}`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || "Failed to load invoice");
          return;
        }

        setData(json);
      } catch {
        setError("Failed to load invoice");
      } finally {
        setLoading(false);
      }
    }

    fetchInvoice();
  }, [token]);

  async function handlePay() {
    setPaying(true);
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to create checkout session");
        setPaying(false);
        return;
      }

      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
      }
    } catch {
      setError("Failed to create checkout session");
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
          <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl text-center">
          <AlertCircle className="h-10 w-10 mx-auto text-red-500" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Unable to load invoice
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  // Success state from Stripe redirect
  if (urlStatus === "success") {
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            Payment Successful
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Thank you for your payment. A confirmation will be sent to your email.
          </p>
        </div>
      </div>
    );
  }

  // Already paid state
  if (data?.status === "paid") {
    const paidInv = data.invoice;
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
            Invoice Already Paid
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Invoice {paidInv.invoiceNumber} has already been paid.
          </p>
        </div>
      </div>
    );
  }

  const inv = data?.invoice as InvoiceData;
  const currency = inv?.currencyCode || "GBP";

  const paymentMethods = data?.paymentMethods || ["pay_by_bank"];
  const hasBank = paymentMethods.includes("pay_by_bank");
  const hasCard = paymentMethods.includes("card") || paymentMethods.includes("online") || paymentMethods.includes("stripe");

  let payButtonLabel = "Pay by Bank";
  let payButtonSubtext = "Instant bank transfer powered by Stripe Open Banking";
  let PayIcon = Building2;

  if (hasBank && hasCard) {
    payButtonLabel = "Pay Online or by Bank";
    payButtonSubtext = "Pay securely via bank transfer or card powered by Stripe";
    PayIcon = CreditCard;
  } else if (hasCard) {
    payButtonLabel = "Pay Online";
    payButtonSubtext = "Secure online payment powered by Stripe";
    PayIcon = CreditCard;
  }

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4 sm:p-6 md:p-10 relative overflow-hidden">
      {/* Subtle website background accents */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(16,185,129,0.06),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#10b98108_1px,transparent_1px),linear-gradient(to_bottom,#10b98108_1px,transparent_1px)] bg-[size:48px_48px] opacity-40 dark:opacity-20" />

      <div className="relative w-full max-w-3xl rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md p-6 sm:p-8 md:p-10 shadow-xl shadow-black/5 dark:shadow-black/20">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3.5">
            {data?.organization?.logoUrl ? (
              <img
                src={data.organization.logoUrl}
                alt={data.organization.name}
                className="h-12 max-h-14 max-w-[180px] object-contain rounded-md"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <Building2 className="h-6 w-6" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                {data?.organization?.name}
              </h1>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 font-mono">
                Invoice {inv.invoiceNumber}
              </p>
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Awaiting Payment
            </span>
          </div>
        </div>

        {/* Invoice details */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 sm:p-5 rounded-xl bg-gray-50/80 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800/80 text-sm mb-8">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Bill to</span>
            <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {data?.contact?.name || "Customer"}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Issue date</span>
            <p className="mt-1 font-mono text-gray-800 dark:text-gray-200">{inv.issueDate}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Due date</span>
            <p className="mt-1 font-mono text-gray-800 dark:text-gray-200">{inv.dueDate}</p>
          </div>
        </div>

        {/* Line items table with Tax column */}
        <div className="overflow-x-auto border-t border-b border-gray-200 dark:border-gray-800 py-4 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800/80 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="text-left pb-3 font-medium">Description</th>
                <th className="text-right pb-3 px-3 font-medium w-20">Qty</th>
                <th className="text-right pb-3 px-3 font-medium w-28">Price</th>
                <th className="text-right pb-3 px-3 font-medium w-28">Tax</th>
                <th className="text-right pb-3 pl-3 font-medium w-32">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-gray-900 dark:text-gray-100">
              {inv.lines.map((line, i) => (
                <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="py-3.5 pr-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{line.description}</p>
                  </td>
                  <td className="text-right py-3.5 px-3 font-mono tabular-nums text-gray-600 dark:text-gray-300">
                    {(line.quantity / 100).toFixed(2)}
                  </td>
                  <td className="text-right py-3.5 px-3 font-mono tabular-nums text-gray-600 dark:text-gray-300">
                    {fmtMoney(line.unitPrice, currency)}
                  </td>
                  <td className="text-right py-3.5 px-3 tabular-nums">
                    {line.taxAmount > 0 ? (
                      <div>
                        <span className="font-mono text-gray-900 dark:text-gray-100">
                          {fmtMoney(line.taxAmount, currency)}
                        </span>
                        {line.taxRate ? (
                          <span className="block text-xs text-gray-400 dark:text-gray-500 font-mono">
                            {(line.taxRate.rate / 100).toFixed(line.taxRate.rate % 100 === 0 ? 0 : 2)}%
                          </span>
                        ) : line.amount > 0 ? (
                          <span className="block text-xs text-gray-400 dark:text-gray-500 font-mono">
                            {Math.round((line.taxAmount / line.amount) * 100)}%
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 font-mono">—</span>
                    )}
                  </td>
                  <td className="text-right py-3.5 pl-3 font-mono tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                    {fmtMoney(line.amount + line.taxAmount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total breakdown */}
        <div className="flex justify-end mb-8">
          <div className="w-full sm:w-80 space-y-2.5">
            {inv.taxTotal != null && inv.taxTotal > 0 && (
              <>
                <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums text-gray-900 dark:text-gray-100">
                    {fmtMoney(inv.subtotal ?? (inv.total - inv.taxTotal), currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>Tax</span>
                  <span className="font-mono tabular-nums text-gray-900 dark:text-gray-100">
                    {fmtMoney(inv.taxTotal, currency)}
                  </span>
                </div>
              </>
            )}
            {inv.amountPaid != null && inv.amountPaid > 0 && (
              <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>Amount paid</span>
                <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  -{fmtMoney(inv.amountPaid, currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-3 border-t border-gray-200 dark:border-gray-800">
              <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Amount due
              </span>
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100 font-mono">
                {fmtMoney(inv.amountDue, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Pay button - emerald green matching website brand */}
        <button
          onClick={handlePay}
          disabled={paying}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-6 shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 active:scale-[0.99] transition-all duration-200 text-base cursor-pointer"
        >
          {paying ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {hasBank && !hasCard ? "Redirecting to your bank..." : "Redirecting to checkout..."}
            </>
          ) : (
            <>
              <PayIcon className="h-5 w-5" />
              {payButtonLabel}
            </>
          )}
        </button>

        {/* Download Invoice PDF */}
        <a
          href={`/api/pay/${token}/pdf`}
          download
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/80 text-gray-700 dark:text-gray-300 font-medium py-3 px-4 transition-colors text-sm shadow-xs"
        >
          <Download className="h-4 w-4" />
          Download Invoice
        </a>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>{payButtonSubtext}</span>
        </div>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50/60 dark:bg-gray-950 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
            <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <PaymentPageContent />
    </Suspense>
  );
}

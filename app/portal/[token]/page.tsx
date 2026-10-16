"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText, ScrollText, MessageSquare, CreditCard, ExternalLink } from "lucide-react";

interface PortalInfo {
  contact: { id: string; name: string; email: string | null };
  organization: { name: string };
}

export default function PortalOverviewPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("Invalid or expired portal link");
        return r.json();
      })
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold text-gray-900">Portal Unavailable</h2>
        <p className="mt-2 text-sm text-gray-600">{error}</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  const sections = [
    {
      title: "Invoices",
      description: "View and pay outstanding or past invoices",
      href: `/portal/${token}/invoices`,
      icon: FileText,
      color: "bg-blue-50 text-blue-600",
    },
    {
      title: "Statements",
      description: "Check your running balance and download PDF statements",
      href: `/portal/${token}/statements`,
      icon: ScrollText,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      title: "Quotes",
      description: "Review, accept, or download price estimates",
      href: `/portal/${token}/quotes`,
      icon: MessageSquare,
      color: "bg-amber-50 text-amber-600",
    },
    {
      title: "Payments",
      description: "See your payment transaction history",
      href: `/portal/${token}/payments`,
      icon: CreditCard,
      color: "bg-purple-50 text-purple-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Welcome, {info.contact.name}</h2>
        <p className="mt-1 text-sm text-gray-600">
          Manage your account with {info.organization.name}. Select a section below or use the tabs above.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((sec) => (
          <button
            key={sec.title}
            onClick={() => router.push(sec.href)}
            className="flex items-center gap-3.5 rounded-lg border bg-white p-4 text-left transition-colors hover:bg-gray-50 hover:border-gray-300"
          >
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${sec.color}`}>
              <sec.icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{sec.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{sec.description}</p>
            </div>
            <ExternalLink className="size-4 shrink-0 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

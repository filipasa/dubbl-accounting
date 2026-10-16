"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileText, ScrollText, MessageSquare, CreditCard } from "lucide-react";

interface PortalInfo {
  contact: { id: string; name: string };
  organization: { name: string };
}

const tabs = [
  { href: "", label: "Overview", icon: FileText },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/statements", label: "Statements", icon: ScrollText },
  { href: "/quotes", label: "Quotes", icon: MessageSquare },
  { href: "/payments", label: "Payments", icon: CreditCard },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { token } = useParams<{ token: string }>();
  const pathname = usePathname();
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const activeTabRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => {});
  }, [token]);

  const basePath = `/portal/${token}`;

  useEffect(() => {
    // Scroll active tab into view on mobile if needed
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [pathname]);

  return (
    <div className="min-h-screen bg-gray-50 w-full overflow-x-hidden">
      <header className="border-b bg-white px-4 sm:px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
              {info?.organization.name || "Loading..."}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500">Customer Portal</p>
          </div>
          {info?.contact.name && (
            <p className="text-xs sm:text-sm text-gray-600 shrink-0 truncate max-w-[140px] sm:max-w-none text-right">
              {info.contact.name}
            </p>
          )}
        </div>
      </header>

      <nav className="border-b bg-white w-full sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto scrollbar-none py-0 -mb-px">
            {tabs.map((tab) => {
              const href = `${basePath}${tab.href}`;
              const isActive =
                tab.href === ""
                  ? pathname === basePath
                  : pathname.startsWith(href);
              return (
                <Link
                  key={tab.href}
                  ref={isActive ? activeTabRef : null}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-2 px-3.5 py-3 text-sm border-b-2 transition-colors whitespace-nowrap",
                    isActive
                      ? "border-blue-600 text-blue-600 font-medium"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  )}
                >
                  <tab.icon className="size-4 shrink-0" />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 w-full min-w-0">
        {children}
      </main>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Payment {
  invoiceNumber: string;
  invoiceId: string;
  amountPaid: number;
  total: number;
  paidAt: string | null;
  status: string;
  currencyCode: string;
}

import { formatMoney } from "@/lib/money";

export default function PortalPaymentsPage() {
  const { token } = useParams<{ token: string }>();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/portal/${token}/payments`)
      .then(r => r.json())
      .then(data => setPayments(data.data || []))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div className="flex min-h-[400px] items-center justify-center"><p className="text-sm text-gray-500">Loading...</p></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Payment History</h2>

      <div className="rounded-lg border overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Invoice</TableHead>
              <TableHead className="text-right whitespace-nowrap">Invoice Total</TableHead>
              <TableHead className="text-right whitespace-nowrap">Amount Paid</TableHead>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-gray-500 py-8">
                  No payments found
                </TableCell>
              </TableRow>
            ) : (
              payments.map(p => (
                <TableRow key={p.invoiceId}>
                  <TableCell className="text-sm font-medium whitespace-nowrap">{p.invoiceNumber}</TableCell>
                  <TableCell className="text-sm text-right whitespace-nowrap">{formatMoney(p.total, p.currencyCode)}</TableCell>
                  <TableCell className="text-sm text-right font-medium whitespace-nowrap">{formatMoney(p.amountPaid, p.currencyCode)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={p.status === "paid" ? "default" : "secondary"} className="text-xs">
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

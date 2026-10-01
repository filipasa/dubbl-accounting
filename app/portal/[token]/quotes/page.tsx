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
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Quote {
  id: string;
  quoteNumber: string;
  issueDate: string;
  expiryDate: string;
  total: number;
  status: string;
  currencyCode: string;
}

import { formatMoney } from "@/lib/money";

export default function PortalQuotesPage() {
  const { token } = useParams<{ token: string }>();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const loadQuotes = () => {
    fetch(`/api/v1/portal/${token}/quotes`)
      .then(r => r.json())
      .then(data => setQuotes(data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadQuotes(); }, [token]);

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    try {
      await fetch(`/api/v1/portal/${token}/quotes/${id}/accept`, { method: "POST" });
      loadQuotes();
    } finally {
      setAcceptingId(null);
    }
  };

  if (loading) {
    return <div className="flex min-h-[400px] items-center justify-center"><p className="text-sm text-gray-500">Loading...</p></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Quotes</h2>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-gray-500 py-8">
                  No quotes found
                </TableCell>
              </TableRow>
            ) : (
              quotes.map(q => (
                <TableRow key={q.id}>
                  <TableCell className="text-sm font-medium">{q.quoteNumber}</TableCell>
                  <TableCell className="text-sm">{q.issueDate}</TableCell>
                  <TableCell className="text-sm">{q.expiryDate}</TableCell>
                  <TableCell className="text-sm text-right">{formatMoney(q.total, q.currencyCode)}</TableCell>
                  <TableCell>
                    <Badge variant={q.status === "accepted" ? "default" : q.status === "declined" ? "destructive" : "secondary"} className="text-xs">
                      {q.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/api/portal/${token}/quotes/${q.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                          <Download className="size-3" />
                          PDF
                        </Button>
                      </a>
                      {q.status === "sent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={acceptingId === q.id}
                          onClick={() => handleAccept(q.id)}
                        >
                          {acceptingId === q.id ? "Accepting..." : "Accept"}
                        </Button>
                      )}
                    </div>
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

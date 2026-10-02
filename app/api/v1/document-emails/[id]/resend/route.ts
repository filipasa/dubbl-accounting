import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documentEmailLog, organization, documentTemplate } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { handleError, notFound } from "@/lib/api/response";
import { notDeleted } from "@/lib/db/soft-delete";
import { sendDocumentEmail } from "@/lib/email/document-sender";
import { resolveTaxLabel } from "@/lib/tax/tax-label";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);

    const logEntry = await db.query.documentEmailLog.findFirst({
      where: and(
        eq(documentEmailLog.id, id),
        eq(documentEmailLog.organizationId, ctx.organizationId)
      ),
    });

    if (!logEntry) return notFound("Email log entry");

    // Get org email for reply-to
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
    });

    // Re-generate PDF for invoices/quotes if original had attachment
    let pdfBuffer: Buffer | undefined;
    let pdfFilename: string | undefined;

    if (logEntry.attachPdf && logEntry.documentType === "invoice") {
      try {
        const { invoice } = await import("@/lib/db/schema");
        const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");

        const inv = await db.query.invoice.findFirst({
          where: eq(invoice.id, logEntry.documentId),
          with: {
            lines: {
              with: { taxRate: true },
            },
            contact: true,
          },
        });

        if (inv) {
          const invTemplate = await db.query.documentTemplate.findFirst({
            where: and(
              eq(documentTemplate.organizationId, ctx.organizationId),
              eq(documentTemplate.type, "invoice"),
              eq(documentTemplate.isDefault, true),
              notDeleted(documentTemplate.deletedAt)
            ),
          });
          const taxLabel = resolveTaxLabel(inv.lines, inv.taxTotal);
          const buf = await renderInvoicePdf(
            {
              invoiceNumber: inv.invoiceNumber,
              issueDate: inv.issueDate,
              dueDate: inv.dueDate,
              dateFormat: org?.dateFormat || null,
              currencyCode: inv.currencyCode || org?.defaultCurrency || "GBP",
              lines: inv.lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                taxAmount: l.taxAmount,
                amount: l.amount,
                taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
              })),
              subtotal: inv.subtotal,
              taxTotal: inv.taxTotal,
              taxLabel,
              total: inv.total,
              amountPaid: inv.amountPaid,
              amountDue: inv.amountDue,
              reference: inv.reference,
              notes: inv.notes,
            },
            { name: org?.name || "", dateFormat: org?.dateFormat || null },
            inv.contact ? { name: inv.contact.name } : { name: "Unknown" },
            invTemplate || {}
          );
          pdfBuffer = Buffer.from(buf);
          pdfFilename = `invoice-${inv.invoiceNumber}.pdf`;
        }
      } catch {
        // PDF generation failed, resend without attachment
      }
    } else if (logEntry.attachPdf && logEntry.documentType === "quote") {
      try {
        const { quote } = await import("@/lib/db/schema");
        const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");

        const q = await db.query.quote.findFirst({
          where: eq(quote.id, logEntry.documentId),
          with: {
            lines: {
              with: { taxRate: true },
            },
            contact: true,
          },
        });

        if (q) {
          const quoteTemplate = await db.query.documentTemplate.findFirst({
            where: and(
              eq(documentTemplate.organizationId, ctx.organizationId),
              eq(documentTemplate.type, "quote"),
              eq(documentTemplate.isDefault, true),
              notDeleted(documentTemplate.deletedAt)
            ),
          });
          const taxLabel = resolveTaxLabel(q.lines, q.taxTotal);
          const buf = await renderInvoicePdf(
            {
              invoiceNumber: q.quoteNumber,
              issueDate: q.issueDate,
              dueDate: q.expiryDate || q.issueDate,
              dateFormat: org?.dateFormat || null,
              currencyCode: q.currencyCode || org?.defaultCurrency || "GBP",
              lines: q.lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                taxAmount: l.taxAmount,
                amount: l.amount,
                taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
              })),
              subtotal: q.subtotal,
              taxTotal: q.taxTotal,
              taxLabel,
              total: q.total,
              reference: q.reference,
              notes: q.notes,
            },
            { name: org?.name || "", dateFormat: org?.dateFormat || null },
            q.contact ? { name: q.contact.name } : { name: "Unknown" },
            quoteTemplate || {},
            {
              title: "Quote",
              numberLabel: "Quote number",
              partyLabel: "Quote for",
              amountLabel: "Total",
              taxLabel: taxLabel ?? undefined,
              dateLabel: q.expiryDate ? "Valid until" : null,
              summaryNoun: q.expiryDate ? "valid until" : null,
            }
          );
          pdfBuffer = Buffer.from(buf);
          pdfFilename = `quote-${q.quoteNumber}.pdf`;
        }
      } catch {
        // PDF generation failed, resend without attachment
      }
    }

    const result = await sendDocumentEmail({
      orgId: ctx.organizationId,
      userId: ctx.userId,
      documentType: logEntry.documentType,
      documentId: logEntry.documentId,
      recipientEmail: logEntry.recipientEmail,
      subject: logEntry.subject,
      body: logEntry.body,
      attachPdf: logEntry.attachPdf,
      pdfBuffer,
      pdfFilename,
      replyTo: org?.contactEmail || undefined,
    });

    return NextResponse.json({ emailLog: result });
  } catch (err) {
    return handleError(err);
  }
}

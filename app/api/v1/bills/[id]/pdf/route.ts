import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bill, documentTemplate, organization } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { notDeleted } from "@/lib/db/soft-delete";
import { notFound, handleError } from "@/lib/api/response";
import { generateBillHtml, type DocumentData } from "@/lib/documents/pdf-generator";
import { formatContactAddress, buildSenderSnapshot } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const found = await db.query.bill.findFirst({
      where: and(
        eq(bill.id, id),
        eq(bill.organizationId, ctx.organizationId),
        notDeleted(bill.deletedAt)
      ),
      with: {
        lines: {
          with: { taxRate: true },
        },
        contact: true,
      },
    });

    if (!found) return notFound("Bill");

    // Bills are supplier-facing; reuse the purchase_order template if a
    // default one exists (there is no dedicated bill template type).
    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, ctx.organizationId),
        eq(documentTemplate.type, "purchase_order"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
    });
    const orgInfo = await buildSenderSnapshot(ctx.organizationId);

    const contactAddress = formatContactAddress(
      found.contact?.addresses as Record<string, { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }> | null
    );

    const taxLabel = resolveTaxLabel(found.lines, found.taxTotal);

    const docData: DocumentData = {
      documentNumber: found.billNumber,
      issueDate: found.issueDate,
      secondDate: found.dueDate,
      dateFormat: org?.dateFormat || null,
      contactName: found.contact?.name ?? "Unknown",
      contactEmail: found.contact?.email ?? null,
      contactAddress,
      contactTaxNumber: found.contact?.taxNumber ?? null,
      lines: found.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxAmount: l.taxAmount,
        amount: l.amount,
        discountPercent: l.discountPercent,
        taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
      })),
      subtotal: found.subtotal,
      taxTotal: found.taxTotal,
      taxLabel,
      total: found.total,
      amountPaid: found.amountPaid,
      amountDue: found.amountDue,
      currencyCode: found.currencyCode,
      reference: found.reference,
      notes: found.notes,
    };

    const templateSettings = template || {};

    if (format === "pdf") {
      const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");
      const pdfBuffer = await renderInvoicePdf(
        {
          invoiceNumber: docData.documentNumber,
          issueDate: docData.issueDate,
          dueDate: docData.secondDate || docData.issueDate,
          dateFormat: org?.dateFormat || null,
          lines: docData.lines,
          subtotal: docData.subtotal,
          taxTotal: docData.taxTotal,
          taxLabel,
          total: docData.total,
          amountPaid: docData.amountPaid,
          amountDue: docData.amountDue,
          currencyCode: docData.currencyCode,
          reference: docData.reference,
          notes: docData.notes,
        },
        orgInfo,
        {
          name: docData.contactName,
          email: docData.contactEmail,
          address: contactAddress,
          taxNumber: docData.contactTaxNumber,
        },
        templateSettings,
        {
          title: "Bill",
          numberLabel: "Bill number",
          partyLabel: "Supplier",
          amountLabel: "Amount due",
          taxLabel: taxLabel ?? undefined,
          dateLabel: "Date due",
          summaryNoun: "due",
        }
      );

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="bill-${found.billNumber}.pdf"`,
        },
      });
    }

    const html = generateBillHtml(docData, orgInfo, templateSettings);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return handleError(err);
  }
}

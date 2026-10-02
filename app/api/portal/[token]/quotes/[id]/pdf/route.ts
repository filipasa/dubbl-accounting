import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { portalAccessToken, quote, documentTemplate, organization } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { notFound, error, handleError } from "@/lib/api/response";
import { generateQuoteHtml, type DocumentData } from "@/lib/documents/pdf-generator";
import { formatContactAddress, buildSenderSnapshot } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const access = await db.query.portalAccessToken.findFirst({
      where: and(
        eq(portalAccessToken.token, token),
        isNull(portalAccessToken.revokedAt)
      ),
    });

    if (!access) return notFound("Portal access");
    if (access.expiresAt && access.expiresAt < new Date()) {
      return error("Portal link has expired", 410);
    }

    const found = await db.query.quote.findFirst({
      where: and(
        eq(quote.id, id),
        eq(quote.organizationId, access.organizationId),
        eq(quote.contactId, access.contactId),
        notDeleted(quote.deletedAt)
      ),
      with: {
        lines: {
          with: { taxRate: true },
        },
        contact: true,
      },
    });

    if (!found) return notFound("Quote");

    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, access.organizationId),
        eq(documentTemplate.type, "quote"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, access.organizationId),
    });

    const orgInfo = await buildSenderSnapshot(access.organizationId);

    const contactAddress = formatContactAddress(
      found.contact?.addresses as Record<string, { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }> | null
    );

    const currencyCode = found.currencyCode || org?.defaultCurrency || "GBP";
    const taxLabel = resolveTaxLabel(found.lines, found.taxTotal);

    const docData: DocumentData = {
      documentNumber: found.quoteNumber,
      issueDate: found.issueDate,
      secondDate: found.expiryDate,
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
        imageUrl: l.imageUrl || null,
        shortDescription: l.shortDescription || null,
        taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
      })),
      subtotal: found.subtotal,
      taxTotal: found.taxTotal,
      taxLabel,
      total: found.total,
      currencyCode,
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
          title: "Quote",
          numberLabel: "Quote number",
          partyLabel: "Quote for",
          amountLabel: "Total",
          taxLabel: taxLabel ?? undefined,
          dateLabel: docData.secondDate ? "Valid until" : null,
          summaryNoun: docData.secondDate ? "valid until" : null,
        }
      );

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="quote-${found.quoteNumber}.pdf"`,
        },
      });
    }

    const html = generateQuoteHtml(docData, orgInfo, templateSettings);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return handleError(err);
  }
}

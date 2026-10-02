import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { portalAccessToken, invoice, documentTemplate, organization } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { notFound, error, handleError } from "@/lib/api/response";
import { generateInvoiceHtml } from "@/lib/documents/pdf-generator";
import type { SenderSnapshot, RecipientSnapshot } from "@/lib/documents/snapshots";
import { formatContactAddress } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";
import { randomBytes } from "crypto";
import { getPublicAppUrl } from "@/lib/public-url";

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

    const inv = await db.query.invoice.findFirst({
      where: and(
        eq(invoice.id, id),
        eq(invoice.organizationId, access.organizationId),
        eq(invoice.contactId, access.contactId)
      ),
      with: {
        lines: {
          with: { taxRate: true },
        },
        contact: true,
      },
    });

    if (!inv) return notFound("Invoice");

    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, access.organizationId),
        eq(documentTemplate.type, "invoice"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    // Use snapshot if available, otherwise build from live data
    const sender = inv.senderSnapshot as SenderSnapshot | null;
    const recipient = inv.recipientSnapshot as RecipientSnapshot | null;

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, access.organizationId),
    });

    let orgInfo;
    if (sender) {
      orgInfo = { ...sender, dateFormat: (sender as any).dateFormat || org?.dateFormat || null };
    } else {
      const orgAddress = [org?.addressStreet, org?.addressCity, org?.addressState, org?.addressPostalCode, org?.addressCountry]
        .filter(Boolean)
        .join(", ");
      orgInfo = {
        name: org?.name || "Company",
        address: orgAddress || null,
        taxId: org?.taxId || null,
        registrationNumber: org?.businessRegistrationNumber || null,
        phone: org?.contactPhone || null,
        email: org?.contactEmail || null,
        countryCode: org?.countryCode || null,
        dateFormat: org?.dateFormat || null,
      };
    }

    const contactAddress = recipient?.address ?? formatContactAddress(inv.contact?.addresses as Record<string, { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }> | null);
    const taxLabel = resolveTaxLabel(inv.lines, inv.taxTotal);

    let paymentLinkToken = inv.paymentLinkToken;
    if (!paymentLinkToken) {
      paymentLinkToken = randomBytes(24).toString("hex");
      await db
        .update(invoice)
        .set({ paymentLinkToken, updatedAt: new Date() })
        .where(eq(invoice.id, inv.id));
    }

    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || (host && host.startsWith("localhost") ? "http" : "https");
    const baseUrl = host ? `${proto}://${host}` : getPublicAppUrl();
    const paymentUrl = `${baseUrl}/pay/${paymentLinkToken}`;

    const invoiceData = {
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      dateFormat: org?.dateFormat || null,
      status: inv.status,
      contactName: recipient?.name ?? inv.contact?.name ?? "Unknown",
      contactEmail: recipient?.email ?? inv.contact?.email ?? null,
      contactAddress,
      contactTaxNumber: recipient?.taxNumber ?? inv.contact?.taxNumber ?? null,
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
      currencyCode: inv.currencyCode,
      reference: inv.reference,
      notes: inv.notes,
      paymentUrl,
    };

    const templateSettings = template || {};

    if (format === "pdf") {
      const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");
      const pdfBuffer = await renderInvoicePdf(
        {
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          dateFormat: org?.dateFormat || null,
          lines: invoiceData.lines,
          subtotal: inv.subtotal,
          taxTotal: inv.taxTotal,
          taxLabel,
          total: inv.total,
          amountPaid: inv.amountPaid,
          amountDue: inv.amountDue,
          currencyCode: inv.currencyCode,
          reference: inv.reference,
          notes: inv.notes,
          paymentUrl,
        },
        orgInfo,
        {
          name: invoiceData.contactName,
          email: invoiceData.contactEmail,
          address: contactAddress,
          taxNumber: invoiceData.contactTaxNumber,
        },
        templateSettings
      );

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`,
        },
      });
    }

    const html = generateInvoiceHtml(invoiceData, orgInfo, templateSettings);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return handleError(err);
  }
}

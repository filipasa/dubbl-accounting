import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoice, documentTemplate } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { notDeleted } from "@/lib/db/soft-delete";
import { renderInvoicePdf } from "@/lib/documents/pdf-renderer";
import type { SenderSnapshot, RecipientSnapshot } from "@/lib/documents/snapshots";
import { formatContactAddress } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";
import { getPublicAppUrl } from "@/lib/public-url";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const inv = await db.query.invoice.findFirst({
      where: and(
        eq(invoice.paymentLinkToken, token),
        isNull(invoice.deletedAt)
      ),
      with: {
        organization: true,
        contact: true,
        lines: {
          with: { taxRate: true },
        },
      },
    });

    if (!inv) {
      return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });
    }

    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, inv.organizationId),
        eq(documentTemplate.type, "invoice"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    // Use snapshot if available, otherwise build from live data
    const sender = inv.senderSnapshot as SenderSnapshot | null;
    const recipient = inv.recipientSnapshot as RecipientSnapshot | null;

    const org = inv.organization;
    let orgInfo;
    if (sender) {
      orgInfo = sender;
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
      };
    }

    const contactAddress = recipient?.address ?? formatContactAddress(inv.contact?.addresses as Record<string, { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }> | null);
    const taxLabel = resolveTaxLabel(inv.lines, inv.taxTotal);

    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || (host && host.startsWith("localhost") ? "http" : "https");
    const baseUrl = host ? `${proto}://${host}` : getPublicAppUrl();
    const paymentUrl = `${baseUrl}/pay/${token}`;

    const pdfBuffer = await renderInvoicePdf(
      {
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
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
      },
      orgInfo,
      {
        name: recipient?.name ?? inv.contact?.name ?? "Unknown",
        email: recipient?.email ?? inv.contact?.email ?? null,
        address: contactAddress,
        taxNumber: recipient?.taxNumber ?? inv.contact?.taxNumber ?? null,
      },
      template || {}
    );

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}

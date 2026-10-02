import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoice, invoiceLine, documentTemplate, organization } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { notDeleted } from "@/lib/db/soft-delete";
import { notFound, handleError } from "@/lib/api/response";
import { generateInvoiceHtml } from "@/lib/documents/pdf-generator";
import type { SenderSnapshot, RecipientSnapshot } from "@/lib/documents/snapshots";
import { formatContactAddress } from "@/lib/documents/snapshots";
import { resolveTaxLabel } from "@/lib/tax/tax-label";
import { isAdjustmentLine } from "@/lib/documents/line-adjustments";
import { calcTax } from "@/lib/api/tax-calculator";
import { randomBytes } from "crypto";
import { getPublicAppUrl, resolvePublicBaseUrl } from "@/lib/public-url";
import { calculateCommercialCardFee } from "@/lib/money";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const inv = await db.query.invoice.findFirst({
      where: and(
        eq(invoice.id, id),
        eq(invoice.organizationId, ctx.organizationId)
      ),
      with: {
        lines: {
          with: { taxRate: true },
        },
        contact: true,
      },
    });

    if (!inv) return notFound("Invoice");

    // If draft invoice has adjustment lines (discount/shipping) created without taxRateId,
    // heal them using the primary product line's taxRate so VAT is computed on the net total.
    if (inv.status === "draft" && inv.lines.length > 0) {
      const primaryTaxRate = inv.lines
        .map((l) => l.taxRate)
        .find((tr) => tr && tr.rate > 0);

      if (primaryTaxRate) {
        const needsHealing = inv.lines.some(
          (l) => isAdjustmentLine(l) && !l.taxRateId
        );

        if (needsHealing) {
          let updatedTaxTotal = 0;
          for (const line of inv.lines) {
            if (isAdjustmentLine(line) && !line.taxRateId) {
              const taxAmount = calcTax(line.amount, primaryTaxRate.rate);
              await db
                .update(invoiceLine)
                .set({ taxRateId: primaryTaxRate.id, taxAmount })
                .where(eq(invoiceLine.id, line.id));
              line.taxRateId = primaryTaxRate.id;
              line.taxAmount = taxAmount;
              line.taxRate = primaryTaxRate;
            }
            updatedTaxTotal += line.taxAmount;
          }

          const newTaxTotal = Math.max(0, updatedTaxTotal);
          const newTotal = inv.subtotal + newTaxTotal;
          const newAmountDue = Math.max(0, newTotal - (inv.amountPaid ?? 0));

          await db
            .update(invoice)
            .set({
              taxTotal: newTaxTotal,
              total: newTotal,
              amountDue: newAmountDue,
              updatedAt: new Date(),
            })
            .where(eq(invoice.id, inv.id));

          inv.taxTotal = newTaxTotal;
          inv.total = newTotal;
          inv.amountDue = newAmountDue;
        }
      }
    }

    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.organizationId, ctx.organizationId),
        eq(documentTemplate.type, "invoice"),
        eq(documentTemplate.isDefault, true),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    // Use snapshot if available (finalized invoice), otherwise build from live data
    const sender = inv.senderSnapshot as SenderSnapshot | null;
    const recipient = inv.recipientSnapshot as RecipientSnapshot | null;

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
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

    let paymentUrl: string | undefined;
    const hasPaymentEnabled = inv.paymentMethods === null || inv.paymentMethods === undefined || inv.paymentMethods.length > 0;
    if (hasPaymentEnabled) {
      let paymentLinkToken = inv.paymentLinkToken;
      if (!paymentLinkToken) {
        paymentLinkToken = randomBytes(24).toString("hex");
        await db
          .update(invoice)
          .set({ paymentLinkToken, updatedAt: new Date() })
          .where(eq(invoice.id, inv.id));
      }

      const baseUrl = resolvePublicBaseUrl(request);
      paymentUrl = `${baseUrl}/pay/${paymentLinkToken}`;
    }

    const passProcessingFeeParam = url.searchParams.get("passProcessingFee") === "true";

    let previewLines = inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxAmount: l.taxAmount,
      amount: l.amount,
      imageUrl: l.imageUrl || null,
      shortDescription: l.shortDescription || null,
      taxRate: l.taxRate ? { name: l.taxRate.name, rate: l.taxRate.rate } : null,
    }));
    let previewSubtotal = inv.subtotal;
    let previewTotal = inv.total;
    let previewAmountDue = inv.amountDue;

    if (passProcessingFeeParam && !previewLines.some((l) => l.description.toLowerCase().trim() === "payment processing fee")) {
      const fee = calculateCommercialCardFee(inv.amountDue, inv.currencyCode);
      if (fee > 0) {
        previewLines.push({
          description: "Payment Processing Fee",
          quantity: 100,
          unitPrice: fee,
          taxAmount: 0,
          amount: fee,
          imageUrl: null,
          shortDescription: null,
          taxRate: null,
        });
        previewSubtotal += fee;
        previewTotal += fee;
        previewAmountDue += fee;
      }
    }

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
      lines: previewLines,
      subtotal: previewSubtotal,
      taxTotal: inv.taxTotal,
      taxLabel,
      total: previewTotal,
      amountPaid: inv.amountPaid,
      amountDue: previewAmountDue,
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
          subtotal: invoiceData.subtotal,
          taxTotal: inv.taxTotal,
          taxLabel,
          total: invoiceData.total,
          amountPaid: inv.amountPaid,
          amountDue: invoiceData.amountDue,
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

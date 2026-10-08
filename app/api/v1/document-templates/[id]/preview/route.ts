import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documentTemplate } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext } from "@/lib/api/auth-context";
import { notDeleted } from "@/lib/db/soft-delete";
import { notFound, handleError } from "@/lib/api/response";
import { generateInvoiceHtml } from "@/lib/documents/pdf-generator";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getAuthContext(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const template = await db.query.documentTemplate.findFirst({
      where: and(
        eq(documentTemplate.id, id),
        eq(documentTemplate.organizationId, ctx.organizationId),
        notDeleted(documentTemplate.deletedAt)
      ),
    });

    if (!template) return notFound("Template");

    const { organization } = await import("@/lib/db/schema");
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
    });

    const orgAddress = [org?.addressStreet, org?.addressCity, org?.addressState, org?.addressPostalCode, org?.addressCountry]
      .filter(Boolean)
      .join(", ");

    const currencyCode = org?.defaultCurrency || "GBP";
    const isUK = currencyCode === "GBP" || org?.countryCode?.toUpperCase() === "GB";

    const sampleData = {
      invoiceNumber: "INV-0001",
      issueDate: "2026-03-10",
      dueDate: "2026-04-09",
      dateFormat: org?.dateFormat || null,
      status: "draft",
      contactName: "Sample Customer",
      contactEmail: "customer@example.com",
      contactAddress: isUK ? "10 High Street, London, EC1A 1BB" : "123 Main St, Suite 100, New York, NY 10001",
      contactTaxNumber: isUK ? "GB123456789" : "US123456789",
      lines: [
        { description: "Web Development Services", quantity: 100, unitPrice: 15000, taxAmount: 1500, amount: 15000, taxRate: { name: "VAT", rate: 2000 } },
        { description: "UI/UX Design", quantity: 200, unitPrice: 7500, taxAmount: 1500, amount: 15000, taxRate: { name: "VAT", rate: 2000 } },
      ],
      subtotal: 30000,
      taxTotal: 3000,
      taxLabel: "VAT (20%)",
      total: 33000,
      amountPaid: 0,
      amountDue: 33000,
      currencyCode,
      reference: "PO-123",
      notes: null,
      paymentUrl: `${resolvePublicBaseUrl(request)}/pay/sample-preview`,
    };

    const orgInfo = {
      name: org?.name || "Your Company",
      address: orgAddress || null,
      taxId: org?.taxId || null,
      registrationNumber: org?.businessRegistrationNumber || null,
      phone: org?.contactPhone || null,
      email: org?.contactEmail || null,
      countryCode: org?.countryCode || null,
      dateFormat: org?.dateFormat || null,
    };

    const isQuote = template.type === "quote" || template.layout === "quotation";

    const sampleQuoteData = {
      documentNumber: "75295",
      issueDate: "2026-09-08",
      secondDate: "2026-09-23",
      dateFormat: org?.dateFormat || null,
      contactName: "Sophie Brown",
      contactEmail: "sophie.brown@example.com",
      contactAddress: "United Kingdom (UK)",
      contactTaxNumber: null,
      lines: [
        {
          description: "Frameless Hidden Door with Concealed Design",
          shortDescription:
            "Door Size: 1981 x 838\nHinge & Latch Finish: Matt Black\nMagnetic Latch Type: Key Cylinder",
          quantity: 800,
          unitPrice: 55495,
          taxAmount: 88792,
          amount: 443960,
          imageUrl: "/doors-thumbnail.png",
          taxRate: { name: "VAT", rate: 2000 },
        },
        {
          description: "Discounts",
          quantity: 100,
          unitPrice: -32900,
          taxAmount: 0,
          amount: -32900,
        },
        {
          description: "Delivery",
          quantity: 100,
          unitPrice: 15000,
          taxAmount: 0,
          amount: 15000,
        },
      ],
      subtotal: 443960,
      taxTotal: 88792,
      taxLabel: "VAT (20%)",
      total: 514852,
      currencyCode: "GBP",
      reference: null,
      notes: template.notes || "This quotation is valid for 15 days from the issue date.",
    };

    if (format === "pdf") {
      const { renderInvoicePdf } = await import("@/lib/documents/pdf-renderer");
      const pdfBuffer = await renderInvoicePdf(
        {
          invoiceNumber: isQuote ? sampleQuoteData.documentNumber : sampleData.invoiceNumber,
          issueDate: isQuote ? sampleQuoteData.issueDate : sampleData.issueDate,
          dueDate: isQuote ? (sampleQuoteData.secondDate || sampleQuoteData.issueDate) : sampleData.dueDate,
          dateFormat: org?.dateFormat || null,
          lines: isQuote ? sampleQuoteData.lines : sampleData.lines,
          subtotal: isQuote ? sampleQuoteData.subtotal : sampleData.subtotal,
          taxTotal: isQuote ? sampleQuoteData.taxTotal : sampleData.taxTotal,
          taxLabel: isQuote ? sampleQuoteData.taxLabel : sampleData.taxLabel,
          total: isQuote ? sampleQuoteData.total : sampleData.total,
          amountPaid: 0,
          amountDue: isQuote ? sampleQuoteData.total : sampleData.total,
          currencyCode: isQuote ? sampleQuoteData.currencyCode : sampleData.currencyCode,
          reference: isQuote ? sampleQuoteData.reference : sampleData.reference,
          notes: isQuote ? sampleQuoteData.notes : sampleData.notes,
          paymentUrl: isQuote ? null : sampleData.paymentUrl,
        },
        orgInfo,
        {
          name: isQuote ? sampleQuoteData.contactName : sampleData.contactName,
          email: isQuote ? sampleQuoteData.contactEmail : sampleData.contactEmail,
          address: isQuote ? sampleQuoteData.contactAddress : sampleData.contactAddress,
          taxNumber: isQuote ? sampleQuoteData.contactTaxNumber : sampleData.contactTaxNumber,
        },
        template,
        isQuote
          ? {
              title: "Quotation",
              numberLabel: "Quotation No #",
              partyLabel: "Quotation For",
              dateLabel: "Valid Till Date",
            }
          : undefined
      );

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="sample-${template.type}.pdf"`,
        },
      });
    }

    if (isQuote) {
      const { generateQuoteHtml } = await import("@/lib/documents/pdf-generator");
      const html = generateQuoteHtml(sampleQuoteData, orgInfo, template);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const html = generateInvoiceHtml(sampleData, orgInfo, template);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return handleError(err);
  }
}

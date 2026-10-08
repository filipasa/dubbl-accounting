import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Link,
  Svg,
  Path,
} from "@react-pdf/renderer";
import { formatDate } from "@/lib/date";
import { partitionDocumentLines } from "./line-adjustments";
import type {
  OrgInfo,
  ContactInfo,
  PdfInvoiceData,
  PdfTemplateSettings,
  PdfDocumentLabels,
} from "./pdf-renderer";

interface QuotationDocProps {
  invoice: PdfInvoiceData;
  org: OrgInfo;
  contact: ContactInfo;
  template: PdfTemplateSettings;
  labels?: PdfDocumentLabels;
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function replacePlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

function stripBotMentions(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/created\s+via\s+([a-z0-9_-]+\s+)?bot/gi, "")
    .replace(/created\s+via\s+(whatsapp|telegram)/gi, "")
    .replace(/(whatsapp|telegram)\s+bot/gi, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1c1c1c",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica",
    color: "#fe8f3d",
    marginBottom: 12,
  },
  metaTable: {
    marginBottom: 0,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    width: 105,
    fontSize: 8.5,
    color: "#212121",
  },
  metaValue: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#212121",
  },
  logoContainer: {
    maxWidth: 160,
    maxHeight: 65,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  logoImage: {
    maxWidth: 160,
    maxHeight: 65,
    objectFit: "contain",
  },
  cardsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
  },
  card: {
    flex: 1,
    backgroundColor: "#fef2e8",
    borderRadius: 6,
    padding: 12,
  },
  cardTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#fe8f3d",
    marginBottom: 6,
  },
  cardCompanyName: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#1c1c1c",
    marginBottom: 2,
  },
  cardText: {
    fontSize: 8,
    color: "#333333",
    lineHeight: 1.35,
  },
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#fe8f3d",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  tableRow: {
    flexDirection: "row",
    backgroundColor: "#fef2e8",
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#ffffff",
  },
  colItem: {
    flex: 3.2,
  },
  colVatRate: {
    flex: 0.8,
    textAlign: "center",
  },
  colQty: {
    flex: 0.8,
    textAlign: "center",
  },
  colRate: {
    flex: 1.0,
    textAlign: "right",
  },
  colAmount: {
    flex: 1.1,
    textAlign: "right",
  },
  colVat: {
    flex: 1.0,
    textAlign: "right",
  },
  colTotal: {
    flex: 1.2,
    textAlign: "right",
  },
  itemTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  itemIndex: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#1c1c1c",
    marginRight: 4,
    lineHeight: 1.3,
  },
  itemDesc: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#1c1c1c",
    lineHeight: 1.3,
    marginBottom: 4,
  },
  itemAttr: {
    fontSize: 7.5,
    color: "#444444",
    lineHeight: 1.35,
    marginBottom: 2,
  },
  itemThumb: {
    width: 44,
    height: 28,
    borderRadius: 2,
    objectFit: "cover",
    alignSelf: "flex-end",
    marginTop: 6,
    marginLeft: 6,
    borderWidth: 0.5,
    borderColor: "#e5e7eb",
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 4,
  },
  bankCard: {
    width: 250,
    backgroundColor: "#fef2e8",
    borderRadius: 6,
    padding: 12,
  },
  bankTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#fe8f3d",
    marginBottom: 6,
  },
  bankRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bankLabel: {
    width: 95,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1c1c1c",
  },
  bankValue: {
    flex: 1,
    fontSize: 8,
    color: "#1c1c1c",
  },
  totalsContainer: {
    width: 210,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
  },
  totalLabel: {
    fontSize: 8.5,
    color: "#1c1c1c",
  },
  totalValue: {
    fontSize: 8.5,
    color: "#1c1c1c",
  },
  totalDividerTop: {
    borderTopWidth: 1,
    borderTopColor: "#000000",
    marginTop: 4,
    paddingTop: 5,
  },
  grandTotalLabel: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  grandTotalValue: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
  totalDividerBottom: {
    borderBottomWidth: 1.5,
    borderBottomColor: "#000000",
    marginTop: 4,
  },
  notesSection: {
    marginTop: 14,
    fontSize: 8,
    color: "#6b7280",
    lineHeight: 1.35,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerText: {
    fontSize: 7.5,
    color: "#9ca3af",
  },
});

export function QuotationDocument({
  invoice: inv,
  org,
  contact,
  template,
  labels,
}: QuotationDocProps) {
  const accent = template.accentColor || "#fe8f3d";
  const title = labels?.title === "Quote" ? "Quotation" : (labels?.title || "Quotation");
  const numberLabel = labels?.numberLabel === "Quote number" ? "Quotation No #" : (labels?.numberLabel || "Quotation No #");

  const activeDateFormat = inv.dateFormat || org.dateFormat || "MMM DD, YYYY";
  const formattedIssueDate = formatDate(inv.issueDate, activeDateFormat);
  const formattedDueDate = formatDate(inv.dueDate, activeDateFormat);

  const { itemLines, discountLines, shippingLines, hasAdjustments, itemsSubtotal } =
    partitionDocumentLines(inv.lines);
  const discountTotal = discountLines.reduce((acc, d) => acc + Math.abs(d.amount), 0);
  const shippingTotal = shippingLines.reduce((acc, s) => acc + Math.abs(s.amount), 0);

  const vars: Record<string, string> = {
    orgName: org.name,
    orgAddress: org.address || "",
    orgTaxId: org.taxId || "",
    orgPhone: org.phone || "",
    orgEmail: org.email || "",
    orgRegistrationNumber: org.registrationNumber || "",
    invoiceNumber: inv.invoiceNumber,
    issueDate: formattedIssueDate,
    dueDate: formattedDueDate,
    contactName: contact.name,
    contactEmail: contact.email || "",
    contactAddress: contact.address || "",
    contactTaxNumber: contact.taxNumber || "",
    reference: inv.reference || "",
    subtotal: fmtMoney(hasAdjustments ? itemsSubtotal : inv.subtotal, inv.currencyCode),
    taxTotal: fmtMoney(inv.taxTotal, inv.currencyCode),
    total: fmtMoney(inv.total, inv.currencyCode),
    currency: inv.currencyCode,
  };

  const bankDetailsText = template.bankDetails
    ? replacePlaceholders(template.bankDetails, vars)
    : null;
  const rawNotes = template.notes || inv.notes
    ? replacePlaceholders(template.notes || inv.notes || "", vars)
    : null;
  const notesText = stripBotMentions(rawNotes);
  const footerText = template.footerHtml
    ? replacePlaceholders(template.footerHtml, vars).replace(/<[^>]*>/g, "")
    : null;

  // Determine company name and address lines
  const isDoorsDelivered =
    org.name.toLowerCase().includes("doors delivered") ||
    org.registrationNumber === "14814854";

  const companyDisplayName = isDoorsDelivered
    ? "Legacy line Ventures LTD T/N DOORS DELIVERED"
    : org.name;
  const companyEmail = org.email || (isDoorsDelivered ? "sales@doorsdelivered.com" : null);

  const companyAddressLines: string[] = [];
  if (isDoorsDelivered && !org.address) {
    companyAddressLines.push("Unit A, 82 James Carter Road,");
    companyAddressLines.push("Bury St. Edmunds,");
    companyAddressLines.push("Mildenhall, United Kingdom (UK) - IP28 7DE");
  } else if (org.address) {
    companyAddressLines.push(...org.address.split(",").map((s) => s.trim()));
  }

  // Parse bank details lines if formatted as "Label: Value" or "Label Value"
  const parsedBankRows: { label: string; value: string }[] = [];
  if (bankDetailsText) {
    const lines = bankDetailsText.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of lines) {
      const colonIdx = l.indexOf(":");
      if (colonIdx > -1) {
        parsedBankRows.push({
          label: l.slice(0, colonIdx).trim(),
          value: l.slice(colonIdx + 1).trim(),
        });
      } else {
        parsedBankRows.push({ label: "", value: l });
      }
    }
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header: Title and Meta on Left, Logo on Right */}
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={[s.title, { color: accent }]}>{title}</Text>
            <View style={s.metaTable}>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>{numberLabel}</Text>
                <Text style={s.metaValue}>{inv.invoiceNumber}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Quotation Date</Text>
                <Text style={s.metaValue}>{formattedIssueDate}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Valid Till Date</Text>
                <Text style={s.metaValue}>{formattedDueDate}</Text>
              </View>
              {inv.reference && (
                <View style={s.metaRow}>
                  <Text style={s.metaLabel}>Reference</Text>
                  <Text style={s.metaValue}>{inv.reference}</Text>
                </View>
              )}
            </View>
          </View>

          {template.logoUrl && (
            <View style={s.logoContainer}>
              <Image src={template.logoUrl} style={s.logoImage} />
            </View>
          )}
        </View>

        {/* Side-by-Side Cards: Quotation From & Quotation For */}
        <View style={s.cardsRow}>
          {/* Left Card: Quotation From */}
          <View style={s.card}>
            <Text style={[s.cardTitle, { color: accent }]}>Quotation From</Text>
            <Text style={s.cardCompanyName}>{companyDisplayName}</Text>
            {companyAddressLines.map((line, idx) => (
              <Text key={`addr-${idx}`} style={s.cardText}>
                {line}
              </Text>
            ))}
            {companyEmail && (
              <Text style={s.cardText}>Email: {companyEmail}</Text>
            )}
            {org.phone && <Text style={s.cardText}>Phone: {org.phone}</Text>}
            {org.taxId && <Text style={s.cardText}>VAT: {org.taxId}</Text>}
          </View>

          {/* Right Card: Quotation For */}
          <View style={s.card}>
            <Text style={[s.cardTitle, { color: accent }]}>
              {labels?.partyLabel || "Quotation For"}
            </Text>
            <Text style={s.cardCompanyName}>{contact.name}</Text>
            {contact.address && (
              <Text style={s.cardText}>{contact.address}</Text>
            )}
            {contact.email && (
              <Text style={s.cardText}>Email: {contact.email}</Text>
            )}
            {contact.taxNumber && (
              <Text style={s.cardText}>VAT: {contact.taxNumber}</Text>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={s.table}>
          {/* Header Row */}
          <View style={[s.tableHeader, { backgroundColor: accent }]}>
            <Text style={[s.th, s.colItem]}>Item</Text>
            <Text style={[s.th, s.colVatRate]}>VAT Rate</Text>
            <Text style={[s.th, s.colQty]}>Quantity</Text>
            <Text style={[s.th, s.colRate]}>Rate</Text>
            <Text style={[s.th, s.colAmount]}>Amount</Text>
            <Text style={[s.th, s.colVat]}>VAT</Text>
            <Text style={[s.th, s.colTotal]}>Total</Text>
          </View>

          {/* Item Rows */}
          {itemLines.map((line, idx) => {
            // Split multi-line descriptions into title + attributes
            const descParts = line.description
              .split("\n")
              .map((p) => p.trim())
              .filter(Boolean);
            const mainTitle = descParts[0] || line.description;
            const extraLines = descParts.slice(1);
            const attrLines = line.shortDescription
              ? line.shortDescription.split("\n").map((p) => p.trim()).filter(Boolean)
              : extraLines;

            // VAT Rate string (e.g. "20%")
            const vatRateStr = line.taxRate?.rate
              ? `${(line.taxRate.rate / 100).toFixed(0)}%`
              : line.amount > 0 && line.taxAmount > 0
              ? `${Math.round((line.taxAmount / line.amount) * 100)}%`
              : "-";

            // Quantity formatted
            const qtyNum = line.quantity / 100;
            const qtyStr = Number.isInteger(qtyNum) ? `${qtyNum}` : qtyNum.toFixed(2);

            const rowGrossTotal = line.amount + line.taxAmount;

            return (
              <View key={`row-${idx}`} style={s.tableRow}>
                {/* Item Column: Number, Title, Attributes & Thumbnail */}
                <View style={s.colItem}>
                  <View style={s.itemTitleRow}>
                    <Text style={s.itemIndex}>{idx + 1}.</Text>
                    <View style={{ flex: 1, paddingRight: 4 }}>
                      <Text style={s.itemDesc}>{mainTitle}</Text>
                      {attrLines.length > 0 && (
                        <View style={{ marginTop: 2 }}>
                          {attrLines.map((attr, aIdx) => (
                            <Text key={`attr-${aIdx}`} style={s.itemAttr}>
                              {attr}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                    {line.imageUrl && (
                      <Image src={line.imageUrl} style={s.itemThumb} />
                    )}
                  </View>
                </View>

                {/* VAT Rate */}
                <Text style={[s.colVatRate, { fontSize: 8, color: "#1c1c1c" }]}>
                  {vatRateStr}
                </Text>

                {/* Quantity */}
                <Text style={[s.colQty, { fontSize: 8, color: "#1c1c1c" }]}>
                  {qtyStr}
                </Text>

                {/* Unit Price Rate */}
                <Text style={[s.colRate, { fontSize: 8, color: "#1c1c1c" }]}>
                  {fmtMoney(line.unitPrice, inv.currencyCode)}
                </Text>

                {/* Net Amount */}
                <Text style={[s.colAmount, { fontSize: 8, color: "#1c1c1c" }]}>
                  {fmtMoney(line.amount, inv.currencyCode)}
                </Text>

                {/* VAT Amount */}
                <Text style={[s.colVat, { fontSize: 8, color: "#1c1c1c" }]}>
                  {fmtMoney(line.taxAmount, inv.currencyCode)}
                </Text>

                {/* Line Total */}
                <Text
                  style={[
                    s.colTotal,
                    { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1c1c1c" },
                  ]}
                >
                  {fmtMoney(rowGrossTotal, inv.currencyCode)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bottom Section: Bank Details on Left, Totals on Right */}
        <View style={s.bottomRow}>
          {/* Bank Details Card */}
          {parsedBankRows.length > 0 ? (
            <View style={s.bankCard}>
              <Text style={[s.bankTitle, { color: accent }]}>Bank Details</Text>
              {parsedBankRows.map((r, bIdx) => (
                <View key={`b-${bIdx}`} style={s.bankRow}>
                  {r.label ? (
                    <>
                      <Text style={s.bankLabel}>{r.label}</Text>
                      <Text style={s.bankValue}>{r.value}</Text>
                    </>
                  ) : (
                    <Text style={s.bankValue}>{r.value}</Text>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* Totals Summary */}
          <View style={s.totalsContainer}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Amount</Text>
              <Text style={s.totalValue}>
                {fmtMoney(hasAdjustments ? itemsSubtotal : inv.subtotal, inv.currencyCode)}
              </Text>
            </View>

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>VAT</Text>
              <Text style={s.totalValue}>
                {fmtMoney(inv.taxTotal, inv.currencyCode)}
              </Text>
            </View>

            {discountTotal > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Discounts</Text>
                <Text style={s.totalValue}>
                  ({fmtMoney(discountTotal, inv.currencyCode)})
                </Text>
              </View>
            )}

            {shippingTotal > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Delivery</Text>
                <Text style={s.totalValue}>
                  {fmtMoney(shippingTotal, inv.currencyCode)}
                </Text>
              </View>
            )}

            {/* Solid separator line */}
            <View style={s.totalDividerTop}>
              <View style={s.totalRow}>
                <Text style={s.grandTotalLabel}>Total ({inv.currencyCode})</Text>
                <Text style={s.grandTotalValue}>
                  {fmtMoney(inv.total, inv.currencyCode)}
                </Text>
              </View>
            </View>

            {/* Bottom double line / thick underline */}
            <View style={s.totalDividerBottom} />
          </View>
        </View>

        {/* Optional Notes */}
        {notesText && (
          <View style={s.notesSection}>
            <Text>{notesText}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.footerText}>{inv.invoiceNumber}</Text>
            {footerText && <Text style={s.footerText}>· {footerText}</Text>}
          </View>
          <Link src="https://www.fixbooks.io" style={{ textDecoration: "none" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Svg viewBox="0 0 40 32" width={10} height={8}>
                <Path d="M18 4h8a10 10 0 0 1 10 10v4a10 10 0 0 1-10 10h-8V4z" fill="#d1d5db" />
                <Path d="M4 4h8a10 10 0 0 1 10 10v4a10 10 0 0 1-10 10H4V4z" fill="#9ca3af" />
              </Svg>
              <Text style={{ fontSize: 7, color: "#d1d5db", letterSpacing: 0.5 }}>fixbooks</Text>
            </View>
          </Link>
        </View>
      </Page>
    </Document>
  );
}

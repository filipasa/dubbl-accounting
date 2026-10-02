import React from "react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Svg,
  Path,
  Link,
  Image,
} from "@react-pdf/renderer";
import { resolveTaxLabel } from "./tax-label";
import { formatDate } from "@/lib/date";

export interface OrgInfo {
  name: string;
  address?: string | null;
  taxId?: string | null;
  registrationNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  countryCode?: string | null;
  dateFormat?: string | null;
}

export interface ContactInfo {
  name: string;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
}

export interface PdfLineItem {
  description: string;
  shortDescription?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxAmount: number;
  amount: number;
  imageUrl?: string | null;
  taxRate?: { name: string; rate?: number | null } | null;
}

export interface PdfInvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  dateFormat?: string | null;
  lines: PdfLineItem[];
  subtotal: number;
  taxTotal: number;
  taxLabel?: string | null;
  total: number;
  amountPaid?: number;
  amountDue?: number;
  currencyCode: string;
  reference?: string | null;
  notes?: string | null;
}

export interface PdfTemplateSettings {
  logoUrl?: string | null;
  accentColor?: string | null;
  showTaxBreakdown?: boolean;
  showPaymentTerms?: boolean;
  notes?: string | null;
  bankDetails?: string | null;
  paymentInstructions?: string | null;
  footerHtml?: string | null;
}

function getTaxIdLabel(countryCode?: string | null): string {
  if (!countryCode) return "Tax ID";
  const cc = countryCode.toUpperCase();
  const EU = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ];
  if (EU.includes(cc) || cc === "GB") return "VAT";
  if (cc === "AU") return "ABN";
  if (cc === "NZ") return "GST";
  if (cc === "CA") return "GST/HST";
  return "Tax ID";
}

function getInvoiceTitle(countryCode?: string | null, hasTaxId?: boolean): string {
  const cc = countryCode?.toUpperCase();
  if ((cc === "AU" || cc === "NZ") && hasTaxId) return "Tax Invoice";
  return "Invoice";
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

function resolvePdfImage(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  if (url.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", url);
    if (!fs.existsSync(localPath)) return null;

    const ext = path.extname(localPath).toLowerCase();
    // @react-pdf/renderer natively supports PNG and JPEG.
    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
      return localPath;
    }

    // Convert non-PNG/JPEG to PNG
    const pngPath = localPath.replace(/\.[^.]+$/, ".png");
    if (fs.existsSync(pngPath)) {
      return pngPath;
    }

    try {
      execSync(`sips -s format png "${localPath}" --out "${pngPath}"`, { stdio: "ignore" });
      if (fs.existsSync(pngPath)) {
        return pngPath;
      }
    } catch {
      // Fallback
    }
    return localPath;
  }
  return null;
}

async function fetchImageAsDataUri(url: string, timeoutMs = 3500): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/")) {
    return resolvePdfImage(url);
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

// Colors
const dark = "#111827";
const gray = "#6b7280";
const lightGray = "#e5e7eb";

const s = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 50, paddingHorizontal: 40, fontSize: 9, fontFamily: "Helvetica", color: dark },
  // Accent bar
  accentBar: { height: 4, marginBottom: 30 },
  // Header
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  headerLeft: { flex: 1, marginRight: 20 },
  logoContainer: { maxWidth: 180, maxHeight: 60, alignItems: "flex-end", justifyContent: "flex-start" },
  logoImage: { maxWidth: 180, maxHeight: 60, objectFit: "contain" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: dark, marginBottom: 20 },
  // Metadata
  metaBlock: { marginBottom: 0 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 80, fontSize: 9, color: gray },
  metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  // Parties
  partiesRow: { flexDirection: "row", marginBottom: 20 },
  sellerCol: { width: 200, marginRight: 40 },
  buyerCol: { width: 200 },
  partyName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  partyDetail: { fontSize: 9, color: gray, marginBottom: 1 },
  billToLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  // Due summary
  dueSummary: { fontSize: 14, fontFamily: "Helvetica-Bold", color: dark, marginBottom: 20 },
  // Table
  table: { marginBottom: 0 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: dark, paddingBottom: 6 },
  th: { fontSize: 8, color: gray },
  tableRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: lightGray },
  cellDesc: { flex: 3 },
  lineImageWrapper: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: "hidden",
    marginRight: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  lineImageSpacer: {
    width: 22,
    height: 22,
    marginRight: 8,
  },
  lineImage: { width: 22, height: 22, objectFit: "cover" },
  cellQty: { flex: 0.6, textAlign: "right" },
  cellPrice: { flex: 1.2, textAlign: "right" },
  cellDiscount: { flex: 0.8, textAlign: "right" },
  cellAmount: { flex: 1.3, textAlign: "right" },
  // Totals
  totalsContainer: { flexDirection: "row", justifyContent: "flex-end", marginTop: 20 },
  totalsBlock: { width: "50%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderTopWidth: 0.5, borderTopColor: lightGray },
  totalLabel: { fontSize: 9, color: gray },
  totalValue: { fontSize: 9, color: dark },
  amountDueRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderTopWidth: 0.5, borderTopColor: lightGray },
  amountDueLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: dark },
  amountDueValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: dark },
  // Info sections
  infoSection: { marginTop: 20 },
  infoTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: dark, marginBottom: 3 },
  infoText: { fontSize: 9, color: gray, lineHeight: 1.4 },
  // Footer
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: lightGray, paddingTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerText: { fontSize: 8, color: gray },
});

export interface PdfDocumentLabels {
  title?: string;
  numberLabel?: string;
  partyLabel?: string;
  amountLabel?: string;
  taxLabel?: string;
  // Label for the second-date metadata row. Defaults to "Date due" (invoice).
  // Pass null to hide the row entirely (e.g. credit/debit notes have no due date).
  dateLabel?: string | null;
  // The connecting word in the headline/footer summary "{amount} {noun} {date}".
  // Defaults to "due" (invoice). Pass null to show just the amount with no date
  // (e.g. a credit note or purchase order isn't "due" on a date).
  summaryNoun?: string | null;
}

interface InvoiceDocProps {
  invoice: PdfInvoiceData;
  org: OrgInfo;
  contact: ContactInfo;
  template: PdfTemplateSettings;
  labels?: PdfDocumentLabels;
}

function InvoiceDocument({ invoice: inv, org, contact, template, labels }: InvoiceDocProps) {
  const accent = template.accentColor || "#10b981";
  const taxLabel = getTaxIdLabel(org.countryCode);
  const title = labels?.title ?? getInvoiceTitle(org.countryCode, !!org.taxId);
  const appliedTaxLabel = inv.taxLabel || labels?.taxLabel || resolveTaxLabel(inv.lines, inv.taxTotal) || "Tax";
  const amountDue = inv.amountDue ?? inv.total;
  const amountPaid = inv.amountPaid ?? 0;
  const hasDiscount = inv.lines.some((l) => l.discountPercent && l.discountPercent > 0);
  const hasAnyLineImage = inv.lines.some((l) => !!resolvePdfImage(l.imageUrl));

  // The second-date row and the headline/footer summary are invoice-shaped by
  // default ("Date due" / "{amount} due {date}"). Other document types override
  // the wording or suppress them: dateLabel === null hides the date row, and
  // summaryNoun === null shows just the amount with no "due {date}".
  const activeDateFormat = inv.dateFormat || org.dateFormat || null;
  const formattedIssueDate = formatDate(inv.issueDate, activeDateFormat);
  const formattedDueDate = formatDate(inv.dueDate, activeDateFormat);

  const showDateRow = labels?.dateLabel !== null;
  const dateRowLabel = labels?.dateLabel ?? "Date due";
  const summaryNoun = labels?.summaryNoun === undefined ? "due" : labels.summaryNoun;
  const summaryText = summaryNoun
    ? `${fmtMoney(amountDue, inv.currencyCode)} ${summaryNoun} ${formattedDueDate}`
    : fmtMoney(amountDue, inv.currencyCode);

  const vars: Record<string, string> = {
    orgName: org.name, orgAddress: org.address || "", orgTaxId: org.taxId || "",
    orgPhone: org.phone || "", orgEmail: org.email || "", orgRegistrationNumber: org.registrationNumber || "",
    invoiceNumber: inv.invoiceNumber, issueDate: formattedIssueDate, dueDate: formattedDueDate,
    contactName: contact.name, contactEmail: contact.email || "", contactAddress: contact.address || "",
    contactTaxNumber: contact.taxNumber || "", reference: inv.reference || "",
    subtotal: fmtMoney(inv.subtotal, inv.currencyCode), taxTotal: fmtMoney(inv.taxTotal, inv.currencyCode),
    total: fmtMoney(inv.total, inv.currencyCode), currency: inv.currencyCode,
  };

function stripBotMentions(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/created\s+via\s+([a-z0-9_-]+\s+)?bot/gi, "")
    .replace(/created\s+via\s+(whatsapp|telegram)/gi, "")
    .replace(/(whatsapp|telegram)\s+bot/gi, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

  const bankDetailsText = template.bankDetails ? replacePlaceholders(template.bankDetails, vars) : null;
  const paymentInstructionsText = template.paymentInstructions ? replacePlaceholders(template.paymentInstructions, vars) : null;
  const rawNotes = (template.notes || inv.notes) ? replacePlaceholders(template.notes || inv.notes || "", vars) : null;
  const notesText = stripBotMentions(rawNotes);
  const footerText = template.footerHtml
    ? replacePlaceholders(template.footerHtml, vars).replace(/<[^>]*>/g, "")
    : null;

  const resolvedLogo = resolvePdfImage(template.logoUrl);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Thin accent bar at top */}
        <View style={[s.accentBar, { backgroundColor: accent }]} />

        {/* Header (Title, Metadata, Logo) */}
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {/* Invoice title */}
            <Text style={s.title}>{title}</Text>

            {/* Metadata */}
            <View style={s.metaBlock}>
              <View style={s.metaRow}>
                <Text style={[s.metaLabel, { fontFamily: "Helvetica-Bold" }]}>{labels?.numberLabel ?? "Invoice number"}</Text>
                <Text style={s.metaValue}>{inv.invoiceNumber}</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Date of issue</Text>
                <Text style={{ fontSize: 9 }}>{formattedIssueDate}</Text>
              </View>
              {showDateRow && (
                <View style={s.metaRow}>
                  <Text style={s.metaLabel}>{dateRowLabel}</Text>
                  <Text style={{ fontSize: 9 }}>{formattedDueDate}</Text>
                </View>
              )}
              {inv.reference && (
                <View style={s.metaRow}>
                  <Text style={s.metaLabel}>Reference</Text>
                  <Text style={{ fontSize: 9 }}>{inv.reference}</Text>
                </View>
              )}
            </View>
          </View>
          {resolvedLogo && (
            <View style={s.logoContainer}>
              <Image src={resolvedLogo} style={s.logoImage} />
            </View>
          )}
        </View>

        {/* Seller and Buyer */}
        <View style={s.partiesRow}>
          <View style={s.sellerCol}>
            <Text style={s.partyName}>{org.name}</Text>
            {org.address && <Text style={s.partyDetail}>{org.address}</Text>}
            {org.email && <Text style={s.partyDetail}>{org.email}</Text>}
            {org.phone && <Text style={s.partyDetail}>{org.phone}</Text>}
            {org.taxId && <Text style={s.partyDetail}>{taxLabel}: {org.taxId}</Text>}
            {org.registrationNumber && <Text style={s.partyDetail}>Reg: {org.registrationNumber}</Text>}
          </View>
          <View style={s.buyerCol}>
            <Text style={s.billToLabel}>{labels?.partyLabel ?? "Bill to"}</Text>
            <Text style={s.partyDetail}>{contact.name}</Text>
            {contact.address && <Text style={s.partyDetail}>{contact.address}</Text>}
            {contact.email && <Text style={s.partyDetail}>{contact.email}</Text>}
            {contact.taxNumber && <Text style={s.partyDetail}>{taxLabel}: {contact.taxNumber}</Text>}
          </View>
        </View>

        {/* Headline amount summary */}
        <Text style={s.dueSummary}>{summaryText}</Text>

        {/* Line Items */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.th, s.cellDesc]}>Description</Text>
            <Text style={[s.th, s.cellQty]}>Qty</Text>
            <Text style={[s.th, s.cellPrice]}>Unit price</Text>
            {hasDiscount && <Text style={[s.th, s.cellDiscount]}>Discount</Text>}
            <Text style={[s.th, s.cellAmount]}>Amount</Text>
          </View>
          {inv.lines.map((line, i) => {
            const resolvedImg = resolvePdfImage(line.imageUrl);
            return (
              <View key={i} style={s.tableRow}>
                <View style={[s.cellDesc, { flexDirection: "row", alignItems: "flex-start" }]}>
                  {resolvedImg ? (
                    <View style={s.lineImageWrapper}>
                      <Image src={resolvedImg} style={s.lineImage} />
                    </View>
                  ) : hasAnyLineImage ? (
                    <View style={s.lineImageSpacer} />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9.5, color: dark, fontFamily: "Helvetica-Bold" }}>{line.description}</Text>
                    {line.shortDescription && (
                      <Text style={{ fontSize: 8, color: gray, marginTop: 1.5, lineHeight: 1.3 }}>
                        {line.shortDescription}
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={[s.cellQty, { color: dark }]}>{(line.quantity / 100).toFixed(2)}</Text>
                <Text style={[s.cellPrice, { color: dark }]}>{fmtMoney(line.unitPrice, inv.currencyCode)}</Text>
                {hasDiscount && (
                  <Text style={[s.cellDiscount, { color: dark }]}>
                    {line.discountPercent ? `${(line.discountPercent / 100).toFixed(2)}%` : "-"}
                  </Text>
                )}
                <Text style={[s.cellAmount, { color: dark }]}>{fmtMoney(line.amount, inv.currencyCode)}</Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={s.totalsContainer}>
          <View style={s.totalsBlock}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal</Text>
              <Text style={s.totalValue}>{fmtMoney(inv.subtotal, inv.currencyCode)}</Text>
            </View>
            {template.showTaxBreakdown !== false && inv.taxTotal > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>{appliedTaxLabel}</Text>
                <Text style={s.totalValue}>{fmtMoney(inv.taxTotal, inv.currencyCode)}</Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalValue}>{fmtMoney(inv.total, inv.currencyCode)}</Text>
            </View>
            {amountPaid > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Amount paid</Text>
                <Text style={s.totalValue}>{fmtMoney(amountPaid, inv.currencyCode)}</Text>
              </View>
            )}
            <View style={s.amountDueRow}>
              <Text style={s.amountDueLabel}>{labels?.amountLabel ?? "Amount due"}</Text>
              <Text style={s.amountDueValue}>{fmtMoney(amountDue, inv.currencyCode)}</Text>
            </View>
          </View>
        </View>

        {/* Bank Details */}
        {bankDetailsText && (
          <View style={s.infoSection}>
            <Text style={s.infoTitle}>Bank details</Text>
            <Text style={s.infoText}>{bankDetailsText}</Text>
          </View>
        )}

        {/* Payment Instructions */}
        {paymentInstructionsText && (
          <View style={s.infoSection}>
            <Text style={s.infoTitle}>Payment instructions</Text>
            <Text style={s.infoText}>{paymentInstructionsText}</Text>
          </View>
        )}

        {/* Notes */}
        {notesText && (
          <View style={s.infoSection}>
            <Text style={s.infoText}>{notesText}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.footerText}>{inv.invoiceNumber}</Text>
            <Text style={s.footerText}>{summaryText}</Text>
            {footerText && <Text style={s.footerText}>{footerText}</Text>}
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

export async function renderInvoicePdf(
  invoice: PdfInvoiceData,
  org: OrgInfo,
  contact: ContactInfo,
  template: PdfTemplateSettings,
  labels?: PdfDocumentLabels
): Promise<ArrayBuffer> {
  let resolvedLogoUrl = template.logoUrl;
  if (template.logoUrl) {
    try {
      resolvedLogoUrl = await fetchImageAsDataUri(template.logoUrl);
    } catch {
      resolvedLogoUrl = null;
    }
  }

  const effectiveTemplate: PdfTemplateSettings = {
    ...template,
    logoUrl: resolvedLogoUrl,
  };

  const buffer = await renderToBuffer(
    <InvoiceDocument invoice={invoice} org={org} contact={contact} template={effectiveTemplate} labels={labels} />
  );
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

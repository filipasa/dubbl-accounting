import { createHash } from "crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bankAccount,
  bankStatementImport,
  bankTransaction,
  type bankImportFormatEnum,
} from "@/lib/db/schema";
import { decimalToCents } from "@/lib/money";
import { notDeleted } from "@/lib/db/soft-delete";
import { applyBankRulesToTransaction, loadActiveBankRules } from "@/lib/api/bank-rules";

export type BankImportFormat = typeof bankImportFormatEnum.enumValues[number];

export interface CsvColumnMapping {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  reference?: string;
  payee?: string;
  counterparty?: string;
}

export interface ImportPreviewRequest {
  fileName?: string | null;
  content: string;
  format?: BankImportFormat | null;
  mapping?: CsvColumnMapping;
}

export interface NormalizedTransaction {
  date: string;
  postedDate?: string | null;
  description: string;
  amount: number;
  balance?: number | null;
  reference?: string | null;
  payee?: string | null;
  counterparty?: string | null;
  currencyCode?: string | null;
  externalTransactionId?: string | null;
  statementLineRef?: string | null;
  pending?: boolean;
  raw: Record<string, unknown>;
}

export interface ParsedStatement {
  format: BankImportFormat;
  accountIdentifier?: string | null;
  currencyCode?: string | null;
  statementStartDate?: string | null;
  statementEndDate?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  warnings: string[];
  metadata: Record<string, unknown>;
  transactions: NormalizedTransaction[];
}

export interface ImportPreviewResult {
  format: BankImportFormat;
  accountIdentifier: string | null;
  currencyCode: string | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  warnings: string[];
  metadata: Record<string, unknown>;
  rowCount: number;
  transactions: NormalizedTransaction[];
  duplicates: Array<{ dedupeHash: string; description: string; amount: number; date: string }>;
}

export interface CommitImportResult extends ImportPreviewResult {
  imported: number;
  duplicateCount: number;
  importId: string;
}

export async function previewBankStatementImport(
  bankAccountId: string,
  request: ImportPreviewRequest
): Promise<ImportPreviewResult> {
  const account = await db.query.bankAccount.findFirst({
    where: and(eq(bankAccount.id, bankAccountId), notDeleted(bankAccount.deletedAt)),
  });

  if (!account) {
    throw new Error("Bank account not found");
  }

  const parsed = parseBankStatement(request);
  const dedupeMap = await findExistingDuplicates(bankAccountId, parsed.transactions);
  const duplicates = parsed.transactions
    .map((tx) => ({
      dedupeHash: makeTransactionDedupeHash(bankAccountId, tx),
      description: tx.description,
      amount: tx.amount,
      date: tx.date,
    }))
    .filter((tx) => dedupeMap.has(tx.dedupeHash));

  return {
    format: parsed.format,
    accountIdentifier: parsed.accountIdentifier ?? null,
    currencyCode: parsed.currencyCode ?? account.currencyCode,
    statementStartDate: parsed.statementStartDate ?? null,
    statementEndDate: parsed.statementEndDate ?? null,
    openingBalance: parsed.openingBalance ?? null,
    closingBalance: parsed.closingBalance ?? null,
    warnings: parsed.warnings,
    metadata: parsed.metadata,
    rowCount: parsed.transactions.length,
    transactions: parsed.transactions.slice(0, 100),
    duplicates,
  };
}

export async function commitBankStatementImport(
  organizationId: string,
  bankAccountId: string,
  request: ImportPreviewRequest
): Promise<CommitImportResult> {
  const account = await db.query.bankAccount.findFirst({
    where: and(
      eq(bankAccount.id, bankAccountId),
      eq(bankAccount.organizationId, organizationId),
      notDeleted(bankAccount.deletedAt)
    ),
  });

  if (!account) {
    throw new Error("Bank account not found");
  }

  const parsed = parseBankStatement(request);
  const preview = await previewBankStatementImport(bankAccountId, request);
  const contentHash = createHash("sha256").update(request.content).digest("hex");
  const existingHashes = await findExistingDuplicates(bankAccountId, parsed.transactions);

  const [importRow] = await db
    .insert(bankStatementImport)
    .values({
      organizationId,
      bankAccountId,
      format: parsed.format,
      fileName: request.fileName || `statement.${parsed.format}`,
      contentHash,
      accountIdentifier: parsed.accountIdentifier ?? null,
      statementCurrency: parsed.currencyCode ?? account.currencyCode,
      statementStartDate: parsed.statementStartDate ?? null,
      statementEndDate: parsed.statementEndDate ?? null,
      openingBalance: parsed.openingBalance ?? null,
      closingBalance: parsed.closingBalance ?? null,
      warnings: parsed.warnings,
      metadata: parsed.metadata,
      importedCount: 0,
      duplicateCount: preview.duplicates.length,
      errorCount: 0,
    })
    .returning();

  const rowsToInsert = parsed.transactions
    .map((tx) => ({
      tx,
      dedupeHash: makeTransactionDedupeHash(bankAccountId, tx),
    }))
    .filter(({ dedupeHash }) => !existingHashes.has(dedupeHash));

  let runningBalance =
    parsed.openingBalance ??
    account.balance - rowsToInsert.reduce((sum, row) => sum + row.tx.amount, 0);

  // Load the org's active bank rules once so newly imported transactions are
  // auto-categorized as a suggestion (status stays 'unreconciled' unless the
  // matched rule has autoReconcile=true).
  const activeRules = await loadActiveBankRules(organizationId);

  const insertedRows = rowsToInsert.map(({ tx, dedupeHash }) => {
    runningBalance =
      tx.balance != null
        ? tx.balance
        : runningBalance + tx.amount;

    const assignment = activeRules.length
      ? applyBankRulesToTransaction(activeRules, tx)
      : null;

    return {
      bankAccountId,
      date: tx.date,
      postedDate: tx.postedDate || null,
      description: tx.description,
      reference: tx.reference || null,
      amount: tx.amount,
      balance: tx.balance ?? runningBalance,
      status: (assignment?.reconcile ? "reconciled" : "unreconciled") as
        | "reconciled"
        | "unreconciled",
      importId: importRow.id,
      sourceType: "statement_import",
      externalTransactionId: tx.externalTransactionId || null,
      statementLineRef: tx.statementLineRef || null,
      payee: tx.payee || null,
      counterparty: tx.counterparty || null,
      currencyCode: tx.currencyCode || parsed.currencyCode || account.currencyCode,
      pending: tx.pending ?? false,
      rawPayload: tx.raw,
      dedupeHash,
      accountId: assignment?.accountId ?? null,
      contactId: assignment?.contactId ?? null,
      taxRateId: assignment?.taxRateId ?? null,
    };
  });

  if (insertedRows.length > 0) {
    await db.insert(bankTransaction).values(insertedRows);
  }

  const rowsWithBal = insertedRows
    .filter((r) => r.balance != null)
    .sort((a, b) => b.date.localeCompare(a.date));

  const finalBalance =
    parsed.closingBalance ??
    rowsWithBal[0]?.balance ??
    account.balance;

  const newerTx = parsed.statementEndDate
    ? await db.query.bankTransaction.findFirst({
        where: and(
          eq(bankTransaction.bankAccountId, bankAccountId),
          gt(bankTransaction.date, parsed.statementEndDate)
        ),
      })
    : null;

  if (!newerTx && finalBalance !== account.balance) {
    await db
      .update(bankAccount)
      .set({ balance: finalBalance })
      .where(eq(bankAccount.id, bankAccountId));
  }

  await db
    .update(bankStatementImport)
    .set({
      importedCount: insertedRows.length,
      duplicateCount: preview.duplicates.length,
      status:
        insertedRows.length === 0 && preview.duplicates.length > 0
          ? "partial"
          : "completed",
    })
    .where(eq(bankStatementImport.id, importRow.id));

  return {
    ...preview,
    imported: insertedRows.length,
    duplicateCount: preview.duplicates.length,
    importId: importRow.id,
  };
}

async function findExistingDuplicates(
  bankAccountId: string,
  transactions: NormalizedTransaction[]
): Promise<Set<string>> {
  const hashes = Array.from(
    new Set(transactions.map((tx) => makeTransactionDedupeHash(bankAccountId, tx)))
  );

  if (hashes.length === 0) {
    return new Set();
  }

  const existing = await db.query.bankTransaction.findMany({
    where: and(
      eq(bankTransaction.bankAccountId, bankAccountId),
      inArray(bankTransaction.dedupeHash, hashes)
    ),
    columns: { dedupeHash: true },
  });

  return new Set(existing.map((row) => row.dedupeHash).filter(Boolean) as string[]);
}

export function makeTransactionDedupeHash(
  bankAccountId: string,
  transaction: NormalizedTransaction
): string {
  return createHash("sha256")
    .update(
      [
        bankAccountId,
        transaction.externalTransactionId || "",
        transaction.statementLineRef || "",
        transaction.date,
        transaction.amount,
        normalizeText(transaction.description),
        normalizeText(transaction.reference || ""),
      ].join("|")
    )
    .digest("hex");
}

export function parseBankStatement(request: ImportPreviewRequest): ParsedStatement {
  const content = request.content.replace(/^\uFEFF/, "").trim();
  if (!content) {
    throw new Error("Statement content is required");
  }

  const format = detectStatementFormat(request.fileName, content, request.format);
  switch (format) {
    case "csv":
      return parseDelimitedStatement(content, ",", format, request.mapping);
    case "tsv":
      return parseDelimitedStatement(content, "\t", format, request.mapping);
    case "qif":
      return parseQifStatement(content);
    case "ofx":
    case "qfx":
    case "qbo":
      return parseOfxStatement(content, format);
    case "camt052":
    case "camt053":
    case "camt054":
      return parseCamtStatement(content, format);
    case "mt940":
    case "mt942":
      return parseMtStatement(content, format);
    case "bai2":
      return parseBai2Statement(content);
    default:
      throw new Error("Unsupported bank statement format");
  }
}

export function detectStatementFormat(
  fileName: string | null | undefined,
  content: string,
  explicitFormat?: BankImportFormat | null
): BankImportFormat {
  if (explicitFormat) return explicitFormat;

  const extension = (fileName?.split(".").pop() || "").toLowerCase();
  const extensionMap: Partial<Record<string, BankImportFormat>> = {
    csv: "csv",
    tsv: "tsv",
    qif: "qif",
    ofx: "ofx",
    qfx: "qfx",
    qbo: "qbo",
    xml: detectXmlStatementFormat(content),
    bai: "bai2",
    bai2: "bai2",
  };

  if (extension && extensionMap[extension]) {
    return extensionMap[extension]!;
  }

  if (content.startsWith("OFXHEADER:") || /<OFX>/i.test(content)) {
    return "ofx";
  }
  if (/^!Type:/im.test(content)) {
    return "qif";
  }
  if (/^01,/.test(content) || /^02,/.test(content)) {
    return "bai2";
  }
  if (/<Document[\s>]/i.test(content)) {
    return detectXmlStatementFormat(content);
  }
  if (/^:20:/m.test(content) && /^:61:/m.test(content)) {
    return content.includes(":13D:") ? "mt942" : "mt940";
  }

  const sample = content.slice(0, 2000);
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const semicolonCount = (sample.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semicolonCount) {
    return "tsv";
  }

  return "csv";
}

function detectXmlStatementFormat(content: string): BankImportFormat {
  if (/<BkToCstmrAcctRpt/i.test(content)) return "camt052";
  if (/<BkToCstmrStmt/i.test(content)) return "camt053";
  if (/<BkToCstmrDbtCdtNtfctn/i.test(content)) return "camt054";
  if (/<OFX>/i.test(content)) return "ofx";
  return "camt053";
}

const DATE_COLUMN_CANDIDATES = [
  "date",
  "transaction date",
  "trans date",
  "txn date",
  "posting date",
  "posted date",
  "book date",
  "booking date",
  "value date",
  "payment date",
  "operation date",
  "process date",
  "processed date",
  "date time",
  "date & time",
  "date and time",
  "time",
];

const AMOUNT_COLUMN_CANDIDATES = [
  "amount",
  "amount gbp",
  "amount eur",
  "amount usd",
  "transaction amount",
  "net amount",
  "value",
  "sum",
  "total",
];

const DEBIT_COLUMN_CANDIDATES = [
  "paid out",
  "paid out gbp",
  "paid out eur",
  "paid out usd",
  "paid out amount",
  "money out",
  "money out gbp",
  "debit",
  "debit amount",
  "debit amount gbp",
  "debits",
  "withdrawal",
  "withdrawals",
  "out",
  "outgoing",
  "outflow",
  "payments",
  "spent",
];

const CREDIT_COLUMN_CANDIDATES = [
  "paid in",
  "paid in gbp",
  "paid in eur",
  "paid in usd",
  "paid in amount",
  "money in",
  "money in gbp",
  "credit",
  "credit amount",
  "credit amount gbp",
  "credits",
  "deposit",
  "deposits",
  "in",
  "incoming",
  "inflow",
  "received",
];

const BALANCE_COLUMN_CANDIDATES = [
  "balance",
  "running balance",
  "account balance",
  "balance gbp",
  "balance eur",
  "balance usd",
  "current balance",
  "closing balance",
];

const DESC_COLUMN_CANDIDATES = [
  "description",
  "transaction description",
  "narrative",
  "details",
  "transaction details",
  "memo",
  "particulars",
  "transaction narrative",
  "notes",
  "remarks",
];

const REF_COLUMN_CANDIDATES = [
  "reference",
  "transaction id",
  "trans id",
  "txn id",
  "transaction reference",
  "payment reference",
  "ref",
  "ref no",
  "reference no",
  "reference number",
  "fitid",
  "check number",
  "cheque number",
  "cheque no",
  "id",
];

const PAYEE_COLUMN_CANDIDATES = [
  "payee",
  "merchant",
  "name",
  "beneficiary",
  "recipient",
];

const COUNTERPARTY_COLUMN_CANDIDATES = [
  "counterparty",
  "beneficiary",
  "recipient",
  "sender",
  "party",
];

const TYPE_COLUMN_CANDIDATES = [
  "transaction type",
  "type",
  "trans type",
  "txn type",
  "entry type",
  "direction",
  "cr dr",
  "dr cr",
  "indicator",
];

function parseDelimitedStatement(
  content: string,
  delimiter: string,
  format: BankImportFormat,
  mapping?: CsvColumnMapping
): ParsedStatement {
  const { rows } = parseCsvRows(content, delimiter);

  if (rows.length < 2) {
    throw new Error("Statement must contain a header row and at least one data row");
  }

  // Scan the first 25 rows to identify the actual header row
  let headerRowIdx = -1;
  const maxScanRows = Math.min(rows.length, 25);

  for (let i = 0; i < maxScanRows; i++) {
    const candidateHeaders = rows[i].map(normalizeHeader);
    const hasDate = findColumnIndex(candidateHeaders, mapping?.date, DATE_COLUMN_CANDIDATES) !== -1;
    const hasAmount = findColumnIndex(candidateHeaders, mapping?.amount, AMOUNT_COLUMN_CANDIDATES) !== -1;
    const hasDebit = findColumnIndex(candidateHeaders, mapping?.debit, DEBIT_COLUMN_CANDIDATES) !== -1;
    const hasCredit = findColumnIndex(candidateHeaders, mapping?.credit, CREDIT_COLUMN_CANDIDATES) !== -1;

    if (hasDate && (hasAmount || hasDebit || hasCredit)) {
      headerRowIdx = i;
      break;
    }
  }

  // Fallback to row 0 if no clear header was matched in the scan window
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
  }

  // Extract metadata from preamble rows before the header (e.g. Account Name, Sort Code, Account Number)
  const metadata: Record<string, unknown> = {};
  for (let i = 0; i < headerRowIdx; i++) {
    const preambleRow = rows[i];
    if (preambleRow.length >= 2 && preambleRow[0] && preambleRow[1]) {
      const key = normalizeHeader(preambleRow[0]);
      if (key) {
        metadata[key] = preambleRow.slice(1).filter(Boolean).join(" ").trim();
      }
    } else if (preambleRow.length === 1 && preambleRow[0].includes(":")) {
      const colonIdx = preambleRow[0].indexOf(":");
      const key = normalizeHeader(preambleRow[0].slice(0, colonIdx));
      const val = preambleRow[0].slice(colonIdx + 1).trim();
      if (key && val) {
        metadata[key] = val;
      }
    }
  }

  const header = rows[headerRowIdx].map(normalizeHeader);
  const dataRows = rows.slice(headerRowIdx + 1);
  const warnings: string[] = [];

  const dateIdx = findColumnIndex(header, mapping?.date, DATE_COLUMN_CANDIDATES);
  const descIdx = findColumnIndex(header, mapping?.description, DESC_COLUMN_CANDIDATES);
  const amountIdx = findColumnIndex(header, mapping?.amount, AMOUNT_COLUMN_CANDIDATES);
  const debitIdx = findColumnIndex(header, mapping?.debit, DEBIT_COLUMN_CANDIDATES);
  const creditIdx = findColumnIndex(header, mapping?.credit, CREDIT_COLUMN_CANDIDATES);
  const balanceIdx = findColumnIndex(header, mapping?.balance, BALANCE_COLUMN_CANDIDATES);
  const referenceIdx = findColumnIndex(header, mapping?.reference, REF_COLUMN_CANDIDATES);
  const payeeIdx = findColumnIndex(header, mapping?.payee, PAYEE_COLUMN_CANDIDATES);
  const counterpartyIdx = findColumnIndex(header, mapping?.counterparty, COUNTERPARTY_COLUMN_CANDIDATES);
  const typeIdx = findColumnIndex(header, undefined, TYPE_COLUMN_CANDIDATES);

  if (dateIdx === -1) {
    throw new Error("Could not find a date column in the statement header");
  }

  if (amountIdx === -1 && debitIdx === -1 && creditIdx === -1) {
    throw new Error("Could not find an amount, debit, or credit column");
  }

  const transactions: NormalizedTransaction[] = [];
  for (const row of dataRows) {
    if (row.every((cell) => !cell.trim())) continue;
    const rawDate = row[dateIdx]?.trim();
    if (!rawDate) continue;

    const date = normalizeDate(rawDate);
    // If the date column does not parse to a valid date (e.g. footer rows like "Closing Balance" or "Total"), skip it
    if (!date) continue;

    const description =
      row[descIdx]?.trim() ||
      row[payeeIdx]?.trim() ||
      row[counterpartyIdx]?.trim() ||
      (typeIdx !== -1 ? row[typeIdx]?.trim() : "") ||
      "Imported transaction";

    let amount = 0;
    if (amountIdx !== -1) {
      amount = parseLocalizedAmount(row[amountIdx]);
      if (amount > 0 && typeIdx !== -1 && debitIdx === -1 && creditIdx === -1) {
        const typeVal = (row[typeIdx]?.trim() || "").toLowerCase();
        if (/^(d|dr|debit|out|outgoing|withdrawal|payment|card purchase|direct debit)$/i.test(typeVal)) {
          amount = -amount;
        }
      }
    } else {
      const debit = debitIdx !== -1 ? Math.abs(parseLocalizedAmount(row[debitIdx])) : 0;
      const credit = creditIdx !== -1 ? Math.abs(parseLocalizedAmount(row[creditIdx])) : 0;
      amount = credit - debit;
    }

    if (!description && amount === 0) continue;

    const refValue = referenceIdx !== -1 ? emptyToNull(row[referenceIdx]) : null;
    const balanceValue = balanceIdx !== -1 ? emptyToNull(row[balanceIdx]) : null;

    transactions.push({
      date,
      description,
      amount,
      balance: balanceValue != null ? parseLocalizedAmount(balanceValue) : null,
      reference: refValue,
      externalTransactionId: refValue,
      payee: payeeIdx !== -1 ? emptyToNull(row[payeeIdx]) : null,
      counterparty: counterpartyIdx !== -1 ? emptyToNull(row[counterpartyIdx]) : null,
      raw: { row },
    });
  }

  if (transactions.length === 0) {
    warnings.push("No statement lines were parsed from the delimited file.");
  }

  let statementStartDate: string | null = null;
  let statementEndDate: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  if (transactions.length > 0) {
    const dates = transactions.map((t) => t.date).filter(Boolean).sort();
    statementStartDate = dates[0] || null;
    statementEndDate = dates[dates.length - 1] || null;

    const rowsWithDate = transactions.filter((t) => t.date);
    const isReverseChronological =
      rowsWithDate.length >= 2 &&
      rowsWithDate[0].date! > rowsWithDate[rowsWithDate.length - 1].date!;

    const orderedTransactions = isReverseChronological
      ? [...transactions].reverse()
      : transactions;

    const sortedWithBal = orderedTransactions.filter((t) => t.balance != null);
    if (sortedWithBal.length > 0) {
      openingBalance = sortedWithBal[0].balance! - sortedWithBal[0].amount;
      closingBalance = sortedWithBal[sortedWithBal.length - 1].balance!;
    }
  }

  const accountIdentifier =
    typeof metadata["account number"] === "string"
      ? (metadata["account number"] as string)
      : null;

  return {
    format,
    accountIdentifier,
    statementStartDate,
    statementEndDate,
    openingBalance,
    closingBalance,
    warnings,
    metadata: { ...metadata, header },
    transactions,
  };
}

function parseQifStatement(content: string): ParsedStatement {
  const lines = content.split(/\r?\n/);
  const warnings: string[] = [];
  const transactions: NormalizedTransaction[] = [];
  let current: Record<string, string[]> = {};

  for (const line of lines) {
    if (!line) continue;
    if (line === "^") {
      const tx = qifRecordToTransaction(current);
      if (tx) transactions.push(tx);
      current = {};
      continue;
    }
    if (line.startsWith("!")) continue;
    const key = line[0];
    const value = line.slice(1).trim();
    current[key] = current[key] || [];
    current[key].push(value);
  }

  if (Object.keys(current).length > 0) {
    const tx = qifRecordToTransaction(current);
    if (tx) transactions.push(tx);
  }

  if (transactions.length === 0) {
    warnings.push("No transactions were found in the QIF file.");
  }

  return {
    format: "qif",
    warnings,
    metadata: {},
    transactions,
  };
}

function qifRecordToTransaction(record: Record<string, string[]>): NormalizedTransaction | null {
  const date = normalizeDate(record.D?.[0] || "");
  const amount = parseLocalizedAmount(record.T?.[0]);
  const payee = record.P?.[0] || null;
  const memo = record.M?.join(" ").trim() || null;
  const description = [payee, memo].filter(Boolean).join(" - ") || "QIF transaction";
  if (!date || (!amount && !description)) return null;
  return {
    date,
    description,
    amount,
    reference: record.N?.[0] || null,
    payee,
    raw: record,
  };
}

function parseOfxStatement(content: string, format: BankImportFormat): ParsedStatement {
  const warnings: string[] = [];
  const segments = splitOfxSegments(content, "STMTTRN");
  const accountIdentifier = readOfxField(content, "ACCTID");
  const currencyCode = readOfxField(content, "CURDEF");
  const statementStartDate = normalizeDate(readOfxField(content, "DTSTART"));
  const statementEndDate = normalizeDate(readOfxField(content, "DTEND"));
  const openingBalance = null;
  const closingBalance = parseOptionalAmount(readOfxField(content, "BALAMT"));

  const transactions = segments.map((segment) => {
    const name = readOfxField(segment, "NAME");
    const memo = readOfxField(segment, "MEMO");
    const description = [name, memo].filter(Boolean).join(" - ") || "OFX transaction";
    return {
      date: normalizeDate(readOfxField(segment, "DTPOSTED") || readOfxField(segment, "DTUSER")),
      postedDate: normalizeDate(readOfxField(segment, "DTUSER") || readOfxField(segment, "DTPOSTED")),
      description,
      amount: parseLocalizedAmount(readOfxField(segment, "TRNAMT")),
      reference: emptyToNull(readOfxField(segment, "CHECKNUM") || readOfxField(segment, "REFNUM")),
      payee: emptyToNull(name),
      externalTransactionId: emptyToNull(readOfxField(segment, "FITID")),
      statementLineRef: emptyToNull(readOfxField(segment, "SIC") || readOfxField(segment, "REFNUM")),
      currencyCode: emptyToNull(currencyCode),
      raw: {
        trnType: readOfxField(segment, "TRNTYPE"),
        memo,
      },
    } satisfies NormalizedTransaction;
  }).filter((tx) => tx.date);

  if (transactions.length === 0) {
    warnings.push("No transaction entries were found in the OFX/QFX/QBO file.");
  }

  return {
    format,
    accountIdentifier: emptyToNull(accountIdentifier),
    currencyCode: emptyToNull(currencyCode),
    statementStartDate: emptyToNull(statementStartDate),
    statementEndDate: emptyToNull(statementEndDate),
    openingBalance,
    closingBalance,
    warnings,
    metadata: {},
    transactions,
  };
}

function parseCamtStatement(content: string, format: BankImportFormat): ParsedStatement {
  const warnings: string[] = [];
  const entryBlocks = matchXmlBlocks(content, "Ntry");
  const transactions = entryBlocks.map((entry) => {
    const amount = parseLocalizedAmount(readXmlField(entry, "Amt"));
    const creditDebit = readXmlField(entry, "CdtDbtInd");
    const sign = creditDebit === "DBIT" ? -1 : 1;
    const bookingDate =
      normalizeDate(readXmlField(entry, "BookgDt")) ||
      normalizeDate(readXmlField(entry, "ValDt"));
    const remittance = joinXmlFields(entry, ["Ustrd", "AddtlNtryInf", "AddtlTxInf"]);
    const payee =
      readXmlField(entry, "Nm", 1) ||
      readXmlField(entry, "RltdPties");
    const reference =
      readXmlField(entry, "AcctSvcrRef") ||
      readXmlField(entry, "NtryRef") ||
      readXmlField(entry, "TxId");
    const counterparty =
      readXmlField(entry, "Cdtr") ||
      readXmlField(entry, "Dbtr");
    return {
      date: bookingDate,
      postedDate: bookingDate,
      description: remittance || payee || counterparty || "CAMT transaction",
      amount: sign * Math.abs(amount),
      reference: emptyToNull(reference),
      payee: emptyToNull(payee),
      counterparty: emptyToNull(counterparty),
      currencyCode: emptyToNull(readXmlAttribute(entry, "Amt", "Ccy")),
      statementLineRef: emptyToNull(readXmlField(entry, "NtryRef")),
      raw: {
        additionalInfo: readXmlField(entry, "AddtlNtryInf"),
      },
    } satisfies NormalizedTransaction;
  }).filter((tx) => tx.date);

  const balances = matchXmlBlocks(content, "Bal");
  const openingBalance = findCamtBalance(balances, ["OPBD", "PRCD"]);
  const closingBalance = findCamtBalance(balances, ["CLBD", "ITBD"]);

  if (transactions.length === 0) {
    warnings.push("No transaction entries were found in the CAMT file.");
  }

  return {
    format,
    accountIdentifier:
      emptyToNull(readXmlField(content, "IBAN")) ||
      emptyToNull(readXmlField(content, "Othr")) ||
      null,
    currencyCode:
      emptyToNull(readXmlField(content, "Ccy")) ||
      null,
    statementStartDate: emptyToNull(readXmlField(content, "FrDtTm") || readXmlField(content, "FrDt")),
    statementEndDate: emptyToNull(readXmlField(content, "ToDtTm") || readXmlField(content, "ToDt")),
    openingBalance,
    closingBalance,
    warnings,
    metadata: {},
    transactions,
  };
}

function parseMtStatement(content: string, format: BankImportFormat): ParsedStatement {
  const warnings: string[] = [];
  const tags = parseSwiftTags(content);
  const transactions: NormalizedTransaction[] = [];
  const refs86 = tags.filter((tag) => tag.code === "86");
  let ref86Index = 0;

  for (const tag of tags) {
    if (tag.code !== "61") continue;
    const line = parseMt61Line(tag.value);
    const memo = refs86[ref86Index]?.value || "";
    ref86Index += 1;
    if (!line) continue;
    transactions.push({
      date: line.date,
      description: memo || line.description || "SWIFT statement line",
      amount: line.amount,
      reference: line.reference,
      statementLineRef: line.reference,
      raw: { line61: tag.value, line86: memo },
    });
  }

  if (transactions.length === 0) {
    warnings.push("No :61: transaction lines were found in the MT statement.");
  }

  return {
    format,
    accountIdentifier: emptyToNull(tags.find((tag) => tag.code === "25")?.value),
    statementStartDate: emptyToNull(parseMtBalanceDate(tags.find((tag) => tag.code === "60F" || tag.code === "60M")?.value)),
    statementEndDate: emptyToNull(parseMtBalanceDate(tags.find((tag) => tag.code === "62F" || tag.code === "62M")?.value)),
    openingBalance: parseMtBalanceAmount(tags.find((tag) => tag.code === "60F" || tag.code === "60M")?.value),
    closingBalance: parseMtBalanceAmount(tags.find((tag) => tag.code === "62F" || tag.code === "62M")?.value),
    warnings,
    metadata: {},
    transactions,
  };
}

function parseBai2Statement(content: string): ParsedStatement {
  const warnings: string[] = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const transactions: NormalizedTransaction[] = [];
  let currentAccount: string | null = null;
  let currentDate: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("/") ? rawLine.slice(0, -1) : rawLine;
    const parts = line.split(",");
    const recordType = parts[0];

    if (recordType === "02") {
      currentDate = normalizeDate(parts[4] || parts[3] || "");
    }

    if (recordType === "03") {
      currentAccount = parts[1] || null;
    }

    if (recordType === "16") {
      const typeCode = parts[1] || "";
      const amount = parseBai2Amount(parts[2], typeCode);
      const reference = parts[4] || parts[5] || "";
      const description = parts.slice(6).join(" ").replace(/\/$/, "").trim() || `BAI2 ${typeCode}`;
      transactions.push({
        date: currentDate || new Date().toISOString().slice(0, 10),
        description,
        amount,
        reference: emptyToNull(reference),
        statementLineRef: emptyToNull(reference),
        raw: { account: currentAccount, typeCode, line: rawLine },
      });
    }
  }

  if (transactions.length === 0) {
    warnings.push("No transaction detail lines were found in the BAI2 file.");
  }

  return {
    format: "bai2",
    accountIdentifier: currentAccount,
    warnings,
    metadata: {},
    transactions,
  };
}

export function parseCsvRows(
  content: string,
  preferredDelimiter?: string
): { rows: string[][]; delimiter: string } {
  const clean = content.replace(/^\uFEFF/, "");
  let delim = preferredDelimiter || ",";

  // Auto-detect delimiter if comma yields 0 or 1 column while semicolon or tab yields more
  if (!preferredDelimiter || preferredDelimiter === ",") {
    const firstLines = clean.slice(0, 2000);
    const commaCount = (firstLines.match(/,/g) || []).length;
    const semicolonCount = (firstLines.match(/;/g) || []).length;
    const tabCount = (firstLines.match(/\t/g) || []).length;
    if (tabCount > commaCount && tabCount > semicolonCount) {
      delim = "\t";
    } else if (semicolonCount > commaCount) {
      delim = ";";
    }
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  const len = clean.length;

  while (i < len) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && clean[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i += 1;
          continue;
        }
      } else {
        currentField += char;
        i += 1;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i += 1;
        continue;
      } else if (char === delim) {
        currentRow.push(currentField.trim());
        currentField = "";
        i += 1;
        continue;
      } else if (char === "\r") {
        if (i + 1 < len && clean[i + 1] === "\n") {
          i += 1;
        }
        currentRow.push(currentField.trim());
        currentField = "";
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        i += 1;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        currentField = "";
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        i += 1;
        continue;
      } else {
        currentField += char;
        i += 1;
        continue;
      }
    }
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c !== "")) {
      rows.push(currentRow);
    }
  }

  return { rows, delimiter: delim };
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result.map((value) => value.trim());
}

function findColumnIndex(headers: string[], override: string | undefined, candidates: string[]): number {
  if (override) {
    const overrideHeader = normalizeHeader(override);
    const overrideIdx = headers.indexOf(overrideHeader);
    if (overrideIdx !== -1) return overrideIdx;
  }

  // Pass 1: Exact matches
  for (const candidate of candidates) {
    const needle = normalizeHeader(candidate);
    const idx = headers.indexOf(needle);
    if (idx !== -1) return idx;
  }

  // Pass 2: Multi-word phrase containment or whole word token match
  for (const candidate of candidates) {
    const needle = normalizeHeader(candidate);
    if (!needle) continue;
    if (needle.includes(" ")) {
      const idx = headers.findIndex((header) => header.includes(needle));
      if (idx !== -1) return idx;
    } else if (needle.length >= 3) {
      const idx = headers.findIndex((header) => {
        const tokens = header.split(/\s+/);
        return tokens.includes(needle);
      });
      if (idx !== -1) return idx;
    }
  }

  return -1;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseLocalizedAmount(value: string | null | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "--" || /^n\/?a$/i.test(trimmed)) return 0;

  const upper = trimmed.toUpperCase();
  const hasDr = /\bDR\b/.test(upper);
  const hasParentheses = upper.includes("(") && upper.includes(")");
  const hasMinus = upper.includes("-");

  // Strip ISO currency codes, CR/DR indicators, and currency symbols
  let cleaned = upper
    .replace(/[A-Z]{3}\b/g, "")
    .replace(/\b(DR|CR)\b/g, "")
    .replace(/[£$€¥₹]/g, "")
    .replace(/[^\d,.\-()]/g, "")
    .trim();

  cleaned = cleaned.replace(/[()]/g, "").trim();
  if (!cleaned || cleaned === "-") return 0;

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      // European format (e.g. 1.250,50)
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // UK/US format (e.g. 1,250.50)
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (commaCount > 0 && dotCount === 0) {
    const parts = cleaned.split(",");
    cleaned = parts.length === 2 && parts[1].length <= 2
      ? `${parts[0]}.${parts[1]}`
      : cleaned.replace(/,/g, "");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const cents = decimalToCents(cleaned);
  const isNegative = hasDr || hasParentheses || hasMinus;
  return isNegative ? -Math.abs(cents) : cents;
}

function parseOptionalAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  return parseLocalizedAmount(value);
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

export function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const value = raw.trim();
  if (!value) return "";

  // 1. Fast match standard ISO date (with optional time / ISO timezone)
  const isoTimeMatch = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (isoTimeMatch) {
    return isoTimeMatch[1];
  }

  // 2. 14-digit timestamp YYYYMMDDHHMMSS
  if (/^\d{14}(?:\.\d+)?/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  // 3. 8-digit compact date YYYYMMDD
  const eightDigitMatch = value.match(/^(\d{8})(?:[T\s].*)?$/);
  if (eightDigitMatch) {
    const v = eightDigitMatch[1];
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }

  // 4. 6-digit compact date YYMMDD (SWIFT/MT)
  if (/^\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 2));
    const fullYear = year >= 70 ? 1900 + year : 2000 + year;
    return `${fullYear}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  }

  // 5. Strip trailing time portion (e.g. " 14:22:05" or " 14:22")
  const strippedTime = value.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i, "").trim();

  // 6. Text month formats (e.g. "12 Mar 2024", "12-Mar-2024", "12 March 2024", "12/Mar/2024")
  const dayMonthTextMatch = strippedTime.match(/^(\d{1,2})[\s\-\/]+([a-zA-Z]{3,9})[\s\-\/]+(\d{2,4})$/);
  if (dayMonthTextMatch) {
    const day = dayMonthTextMatch[1].padStart(2, "0");
    const monKey = dayMonthTextMatch[2].toLowerCase();
    let year = dayMonthTextMatch[3];
    if (year.length === 2) {
      const y = Number(year);
      year = String(y >= 70 ? 1900 + y : 2000 + y);
    }
    const mon = MONTH_NAME_MAP[monKey];
    if (mon) {
      return `${year}-${mon}-${day}`;
    }
  }

  // 7. "Mar 12, 2024" or "March 12 2024"
  const monthDayTextMatch = strippedTime.match(/^([a-zA-Z]{3,9})[\s\-\/]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-\/]+(\d{2,4})$/);
  if (monthDayTextMatch) {
    const monKey = monthDayTextMatch[1].toLowerCase();
    const day = monthDayTextMatch[2].padStart(2, "0");
    let year = monthDayTextMatch[3];
    if (year.length === 2) {
      const y = Number(year);
      year = String(y >= 70 ? 1900 + y : 2000 + y);
    }
    const mon = MONTH_NAME_MAP[monKey];
    if (mon) {
      return `${year}-${mon}-${day}`;
    }
  }

  // 8. Delimited date formats: DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
  const slash = strippedTime.split(/[\/.\-']/);
  if (slash.length === 3) {
    const [a, b, c] = slash.map((s) => s.trim());
    if (/^\d+$/.test(a) && /^\d+$/.test(b) && /^\d+$/.test(c)) {
      if (a.length === 4) {
        return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
      }

      let year = c;
      if (c.length === 2) {
        const y = Number(c);
        year = String(y >= 70 ? 1900 + y : 2000 + y);
      } else if (c.length !== 4) {
        return "";
      }

      const numA = Number(a);
      const numB = Number(b);

      if (numA > 12 && numB <= 12) {
        return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
      } else if (numB > 12 && numA <= 12) {
        return `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
      } else if (numA <= 31 && numB <= 12) {
        // UK / International default: DD/MM/YYYY
        return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
      }
    }
  }

  // 9. Fallback Date parsing
  const parsed = new Date(strippedTime);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10);
    const yr = Number(iso.slice(0, 4));
    if (yr >= 1970 && yr <= 2100) {
      return iso;
    }
  }

  return "";
}

function readOfxField(content: string, tag: string): string {
  const closing = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const closeMatch = content.match(closing);
  if (closeMatch) return closeMatch[1].trim();

  const sgml = new RegExp(`<${tag}>([^\\r\\n<]+)`, "i");
  const sgmlMatch = content.match(sgml);
  return sgmlMatch?.[1]?.trim() || "";
}

function splitOfxSegments(content: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|(?=<${tag}>|</BANKTRANLIST>|$))`, "gi");
  return Array.from(content.matchAll(regex)).map((match) => match[1]);
}

function matchXmlBlocks(content: string, tag: string): string[] {
  const regex = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  return Array.from(content.matchAll(regex)).map((match) => match[0]);
}

function readXmlField(content: string, tag: string, index = 0): string {
  const regex = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  const matches = Array.from(content.matchAll(regex));
  if (!matches[index]) return "";
  const inner = matches[index][1];
  return stripXmlTags(inner).trim();
}

function readXmlAttribute(content: string, tag: string, attribute: string): string {
  const regex = new RegExp(`<(?:\\w+:)?${tag}[^>]*\\b${attribute}="([^"]+)"[^>]*>`, "i");
  return content.match(regex)?.[1]?.trim() || "";
}

function joinXmlFields(content: string, tags: string[]): string {
  return tags
    .map((tag) => readXmlField(content, tag))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function findCamtBalance(blocks: string[], codes: string[]): number | null {
  for (const block of blocks) {
    const code = readXmlField(block, "Cd");
    if (codes.includes(code)) {
      const amount = readXmlField(block, "Amt");
      return parseOptionalAmount(amount);
    }
  }
  return null;
}

function parseSwiftTags(content: string): Array<{ code: string; value: string }> {
  const lines = content.split(/\r?\n/);
  const tags: Array<{ code: string; value: string }> = [];
  let current: { code: string; value: string } | null = null;

  for (const line of lines) {
    const match = line.match(/^:([0-9A-Z]{2,3}):(.+)$/);
    if (match) {
      if (current) tags.push(current);
      current = { code: match[1], value: match[2].trim() };
      continue;
    }
    if (current) {
      current.value += ` ${line.trim()}`;
    }
  }
  if (current) tags.push(current);
  return tags;
}

function parseMt61Line(value: string): {
  date: string;
  amount: number;
  reference: string | null;
  description: string;
} | null {
  const match = value.match(/^(\d{6})(\d{4})?([RC]?)([DC])([A-Z])?([0-9,]+)N([A-Z0-9]{3})(.*)$/);
  if (!match) return null;
  const [, datePart, , reversal, direction, , amountPart, code, tail] = match;
  const amount = parseLocalizedAmount(amountPart.replace(",", "."));
  const sign = direction === "D" ? -1 : 1;
  const reversalSign = reversal === "R" ? -1 : 1;
  const reference = tail.split("//")[1] || tail || null;
  return {
    date: normalizeDate(datePart),
    amount: sign * reversalSign * Math.abs(amount),
    reference: emptyToNull(reference),
    description: code,
  };
}

function parseMtBalanceDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^[DC](\d{6})/);
  return match ? normalizeDate(match[1]) : null;
}

function parseMtBalanceAmount(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^[DC]\d{6}[A-Z]{3}([0-9,]+)$/);
  return match ? parseLocalizedAmount(match[1].replace(",", ".")) : null;
}

function parseBai2Amount(value: string | undefined, typeCode: string): number {
  const cents = parseLocalizedAmount(value || "");
  return bai2IsCredit(typeCode) ? Math.abs(cents) : -Math.abs(cents);
}

function bai2IsCredit(typeCode: string): boolean {
  const code = Number(typeCode);
  if (Number.isNaN(code)) return true;
  if (code >= 100 && code < 400) return true;
  if (code >= 400 && code < 700) return false;
  if (code >= 700 && code < 900) return true;
  return false;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function listBankStatementImports(bankAccountId: string) {
  return db.query.bankStatementImport.findMany({
    where: eq(bankStatementImport.bankAccountId, bankAccountId),
    orderBy: desc(bankStatementImport.createdAt),
    limit: 20,
  });
}

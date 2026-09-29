import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBankStatement,
  detectStatementFormat,
  normalizeDate,
  parseCsvRows,
} from "../lib/banking/importer";

test("detectStatementFormat correctly identifies csv, tsv, and ofx", () => {
  assert.equal(detectStatementFormat("statement.csv", "Date,Amount\n2024-01-01,10"), "csv");
  assert.equal(detectStatementFormat("statement.tsv", "Date\tAmount\n2024-01-01\t10"), "tsv");
  assert.equal(detectStatementFormat("statement.txt", "Date,Paid out,Paid in\n2024-01-01,10,"), "csv");
  assert.equal(detectStatementFormat(null, "OFXHEADER:100\n<OFX>"), "ofx");
});

test("normalizeDate parses UK DD/MM/YYYY dates correctly", () => {
  assert.equal(normalizeDate("12/03/2024"), "2024-03-12");
  assert.equal(normalizeDate("05/02/2024"), "2024-02-05");
  assert.equal(normalizeDate("29/09/2026"), "2026-09-29");
  assert.equal(normalizeDate("12/03/2024 14:22:05"), "2024-03-12");
  assert.equal(normalizeDate("2024-03-12T14:22:05Z"), "2024-03-12");
  assert.equal(normalizeDate("12-Mar-2024"), "2024-03-12");
  assert.equal(normalizeDate("12 March 2024"), "2024-03-12");
});

test("normalizeDate rejects invalid dates and footer rows", () => {
  assert.equal(normalizeDate("Closing Balance"), "");
  assert.equal(normalizeDate("Total"), "");
  assert.equal(normalizeDate(""), "");
  assert.equal(normalizeDate(null), "");
});

test("parseCsvRows handles quotes, commas in quotes, and multiline values", () => {
  const content = 'Date,Description,Amount\n2024-01-01,"Line 1\nLine 2",100.00\n2024-01-02,"Item, with comma",50.00';
  const { rows, delimiter } = parseCsvRows(content);
  assert.equal(delimiter, ",");
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], "Line 1\nLine 2");
  assert.equal(rows[2][1], "Item, with comma");
});

test("parseBankStatement parses standard Tide UK statement CSV (Paid out / Paid in)", () => {
  const csv = `Date,Transaction description,Paid out,Paid in,Balance
12/03/2024,Direct Debit HMRC,150.00,,1250.00
11/03/2024,Stripe Payout,,500.00,1400.00`;

  const result = parseBankStatement({ content: csv, fileName: "tide.csv" });
  assert.equal(result.transactions.length, 2);

  const tx1 = result.transactions[0];
  assert.equal(tx1.date, "2024-03-12");
  assert.equal(tx1.description, "Direct Debit HMRC");
  assert.equal(tx1.amount, -15000); // £150 out
  assert.equal(tx1.balance, 125000);

  const tx2 = result.transactions[1];
  assert.equal(tx2.date, "2024-03-11");
  assert.equal(tx2.description, "Stripe Payout");
  assert.equal(tx2.amount, 50000); // £500 in
  assert.equal(tx2.balance, 140000);

  assert.equal(result.statementStartDate, "2024-03-11");
  assert.equal(result.statementEndDate, "2024-03-12");
});

test("parseBankStatement parses Tide CSV with preamble metadata headers and timestamps", () => {
  const csv = `Account Name: Dubbl Ltd
Account Number: 21104471
Sort Code: 04-00-04

"Date","Transaction ID","Transaction type","Transaction description","Paid out (GBP)","Paid in (GBP)","Balance (GBP)"
"12/03/2024 14:32:00","TX12345","Transfer","Payment to supplier","100.00","","2,450.00"
"11/03/2024 09:15:22","TX12344","Faster Payment In","Customer payment","","500.00","2,550.00"`;

  const result = parseBankStatement({ content: csv, fileName: "tide_export.csv" });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.accountIdentifier, "21104471");

  const tx1 = result.transactions[0];
  assert.equal(tx1.date, "2024-03-12");
  assert.equal(tx1.description, "Payment to supplier");
  assert.equal(tx1.reference, "TX12345");
  assert.equal(tx1.amount, -10000);
  assert.equal(tx1.balance, 245000);

  const tx2 = result.transactions[1];
  assert.equal(tx2.date, "2024-03-11");
  assert.equal(tx2.description, "Customer payment");
  assert.equal(tx2.reference, "TX12344");
  assert.equal(tx2.amount, 50000);
  assert.equal(tx2.balance, 255000);
});

test("parseBankStatement safely skips footer summary lines", () => {
  const csv = `Date,Transaction description,Paid out,Paid in,Balance
12/03/2024,Coffee,3.50,,100.00
11/03/2024,Lunch,12.00,,103.50
Closing Balance,,,100.00
Total,2 transactions,15.50,,`;

  const result = parseBankStatement({ content: csv, fileName: "statement.csv" });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].description, "Coffee");
  assert.equal(result.transactions[1].description, "Lunch");
});

test("parseBankStatement handles standard Debit / Credit columns", () => {
  const csv = `Date,Description,Debit,Credit,Balance,Reference
2026-03-02,Invoice Payment - Acme Corp,,2500.00,17920.50,INV-2026-001
2026-03-04,Office Supplies - Staples,187.32,,22563.93,TXN-44821`;

  const result = parseBankStatement({ content: csv, fileName: "statement.csv" });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].amount, 250000);
  assert.equal(result.transactions[1].amount, -18732);
});

test("parseBankStatement handles currency symbols and DR/CR notations", () => {
  const csv = `Date,Description,Amount
2024-05-01,Service fee,£15.50 DR
2024-05-02,Refund,£50.00 CR
2024-05-03,Purchase,(£25.00)`;

  const result = parseBankStatement({ content: csv, fileName: "statement.csv" });
  assert.equal(result.transactions.length, 3);
  assert.equal(result.transactions[0].amount, -1550);
  assert.equal(result.transactions[1].amount, 5000);
  assert.equal(result.transactions[2].amount, -2500);
});

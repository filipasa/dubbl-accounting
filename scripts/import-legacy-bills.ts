import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { bill, billLine } from "@/lib/db/schema";
import { getNextNumber } from "@/lib/api/numbering";

const PARSED_JSON_PATH = path.resolve(process.cwd(), "scratch/parsed_orders.json");
const ORGANIZATION_ID = "e1d98c7a-4d4b-4bce-849b-cb84aef0a6d4"; // Doors Delivered
const CONTACT_ID = "7762251d-c273-4764-8aa5-cafdac991ed3";      // VIP MASTER LLС
const COGS_ACCOUNT_ID = "3c95c9ff-394d-45fe-99fa-40c0640b0dc3"; // 5000 - Cost of Goods Sold
const NO_VAT_TAX_RATE_ID = "c96fdf28-502d-4fc1-9243-5e83d1cadc68"; // No VAT (0%)
const USER_ID = "0c84a151-b052-4ced-80e4-8cb30f2c9dc1";        // Filip

interface ParsedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ParsedOrder {
  orderNum: string;
  rawTitle: string;
  issueDate: string;
  dueDate: string;
  total: number;
  lines: ParsedLine[];
}

async function run() {
  const isExecute = process.argv.includes("--execute");
  console.log(`\n======================================================`);
  console.log(`  Import Legacy Orders -> Fixbooks Bills`);
  console.log(`  Mode: ${isExecute ? "EXECUTE (WRITING TO DB)" : "DRY RUN (NO CHANGES)"}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(PARSED_JSON_PATH)) {
    throw new Error(`Parsed orders JSON not found at ${PARSED_JSON_PATH}`);
  }

  const orders: ParsedOrder[] = JSON.parse(fs.readFileSync(PARSED_JSON_PATH, "utf-8"));
  console.log(`Loaded ${orders.length} orders:\n`);

  let grandTotalPence = 0;

  for (const o of orders) {
    const sumPence = o.lines.reduce((acc, l) => acc + Math.round(l.amount * 100), 0);
    const expectedPence = Math.round(o.total * 100);
    grandTotalPence += sumPence;

    console.log(`Order ${o.orderNum}:`);
    console.log(`  Raw Title:     "${o.rawTitle}"`);
    console.log(`  Issue Date:    ${o.issueDate}`);
    console.log(`  Due Date:      ${o.dueDate}`);
    console.log(`  Lines Count:   ${o.lines.length}`);
    console.log(`  Calculated:    £${(sumPence / 100).toFixed(2)} | Reported: £${o.total.toFixed(2)}`);

    if (sumPence !== expectedPence) {
      throw new Error(`Total mismatch in order ${o.orderNum}: calc=${sumPence} vs expected=${expectedPence}`);
    }

    for (const l of o.lines) {
      console.log(`    • ${l.description} (x${l.quantity} @ £${l.unitPrice.toFixed(2)} = £${l.amount.toFixed(2)})`);
    }
    console.log("");
  }

  console.log(`Grand Total across all 5 bills: £${(grandTotalPence / 100).toFixed(2)}`);

  if (!isExecute) {
    console.log("\n[DRY RUN COMPLETE] To write to database, run with --execute.");
    return;
  }

  console.log("\nExecuting database transaction...");

  const createdBills = await db.transaction(async (tx) => {
    const results = [];

    for (const o of orders) {
      // Generate next bill number inside transaction
      const billNumber = await getNextNumber(ORGANIZATION_ID, "bill", "bill_number", "BILL");
      const subtotalPence = o.lines.reduce((acc, l) => acc + Math.round(l.amount * 100), 0);

      const [newBill] = await tx
        .insert(bill)
        .values({
          organizationId: ORGANIZATION_ID,
          contactId: CONTACT_ID,
          billNumber,
          issueDate: o.issueDate,
          dueDate: o.dueDate,
          status: "draft",
          reference: o.orderNum,
          notes: `Imported from 1C Customer Order: ${o.rawTitle}`,
          subtotal: subtotalPence,
          taxTotal: 0,
          total: subtotalPence,
          amountPaid: 0,
          amountDue: subtotalPence,
          currencyCode: "GBP",
          createdBy: USER_ID,
        })
        .returning();

      const processedLines = o.lines.map((l, idx) => ({
        billId: newBill.id,
        description: l.description,
        quantity: Math.round(l.quantity * 100),
        unitPrice: Math.round(l.unitPrice * 100),
        accountId: COGS_ACCOUNT_ID,
        taxRateId: NO_VAT_TAX_RATE_ID,
        discountPercent: 0,
        taxAmount: 0,
        amount: Math.round(l.amount * 100),
        sortOrder: idx,
      }));

      await tx.insert(billLine).values(processedLines);

      results.push({
        id: newBill.id,
        billNumber: newBill.billNumber,
        reference: newBill.reference,
        total: newBill.total,
        linesCount: processedLines.length,
      });
    }

    return results;
  });

  console.log("\n Successfully created bills:");
  for (const b of createdBills) {
    console.log(`  - Bill ${b.billNumber} (Ref: ${b.reference}): £${(b.total / 100).toFixed(2)} (${b.linesCount} lines) [ID: ${b.id}]`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error during import:", err);
    process.exit(1);
  });

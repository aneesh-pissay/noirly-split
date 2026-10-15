/**
 * One-off repair for expenses saved before payers and shares were converted
 * together (see convertParts). Rounding each converted amount on its own left
 * some groups' balances a few units off zero, as debts nobody could settle.
 *
 * Recomputes the base-currency amounts of every converted expense from its
 * original amounts and stored rate. Shows what would change; pass --apply to
 * write.
 *
 *   npx tsx scripts/fix-fx-rounding.ts            # dry run
 *   npx tsx scripts/fix-fx-rounding.ts --apply
 */
import mongoose from "mongoose";
import { convertParts } from "@/src/core/money";
import { Expense } from "@/src/server/models";

const apply = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI");
  await mongoose.connect(uri);

  let checked = 0;
  let changed = 0;
  // Only converted expenses can be off: at rate 1 every amount is exact.
  const cursor = Expense.find({ fxRateToBase: { $nin: [1, null] } }).cursor();
  for await (const expense of cursor) {
    checked += 1;
    const rate = expense.fxRateToBase;
    const paid = convertParts(expense.payers.map((p) => p.amountPaid), rate);
    const owed = convertParts(expense.splits.map((s) => s.amountOwed), rate);
    const differs =
      expense.payers.some((p, i) => p.amountPaidInBase !== paid[i]) ||
      expense.splits.some((s, i) => s.amountOwedInBase !== owed[i]);
    if (!differs) continue;
    changed += 1;
    console.log(`${apply ? "fixing" : "would fix"} expense ${expense._id} (group ${expense.groupId})`);
    if (apply) {
      expense.payers.forEach((p, i) => { p.amountPaidInBase = paid[i]!; });
      expense.splits.forEach((s, i) => { s.amountOwedInBase = owed[i]!; });
      expense.markModified("payers");
      expense.markModified("splits");
      await expense.save();
    }
  }
  console.log(`${checked} converted expenses checked, ${changed} ${apply ? "fixed" : "need fixing"}.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

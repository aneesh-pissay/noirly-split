import { Types } from "mongoose";
import { z } from "zod";
import { applyFx, convertParts, sumMinor } from "@/src/core/money";
import {
  calculateEqualSplit,
  calculatePercentageSplit,
  calculateSharesSplit,
  calculateUnequalSplit,
} from "@/src/core/splits";
import { ApiError } from "@/src/server/api/http";

const allocationSchema = z.object({
  userId: z.string().min(1),
  amountOwed: z.number().int().nonnegative().optional(),
  percentage: z.number().nonnegative().optional(),
  shares: z.number().positive().optional(),
});

const payerSchema = z.object({
  userId: z.string().min(1),
  amountPaid: z.number().int().nonnegative(),
});

const expenseFieldsSchema = z.object({
  amount: z.number().int().positive(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  fxRateToBase: z.number().positive().optional(),
  description: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z
    .enum(["food", "travel", "rent", "utilities", "other"])
    .nullable()
    .optional(),
  /** A receipt uploaded to this group (checked against the group by the route). */
  receiptUrl: z.string().max(300).nullable().optional(),
  /** @deprecated prefer payers[] */
  paidByUserId: z.string().min(1).optional(),
  payers: z.array(payerSchema).optional(),
  splitMethod: z
    .enum(["equal", "unequal", "percentage", "shares"])
    .default("equal"),
  participantIds: z.array(z.string().min(1)).min(1),
  allocations: z.array(allocationSchema).optional(),
  isRecurring: z.boolean().optional(),
  recurrence: z
    .object({
      frequency: z.enum(["weekly", "monthly"]),
      interval: z.number().int().positive().default(1),
      endAt: z.string().datetime().nullable().optional(),
    })
    .nullable()
    .optional(),
});

function refineExpense(
  val: z.infer<typeof expenseFieldsSchema>,
  ctx: z.RefinementCtx,
) {
  const payers =
    val.payers ??
    (val.paidByUserId
      ? [{ userId: val.paidByUserId, amountPaid: val.amount }]
      : []);
  if (payers.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "At least one payer is required",
      path: ["payers"],
    });
  } else {
    const paidSum = sumMinor(payers.map((p) => p.amountPaid));
    if (paidSum !== val.amount) {
      ctx.addIssue({
        code: "custom",
        message: `Payer amounts must sum to ${val.amount} (got ${paidSum})`,
        path: ["payers"],
      });
    }
  }

  if (val.splitMethod === "unequal") {
    if (!val.allocations?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Unequal splits require allocations",
        path: ["allocations"],
      });
    } else {
      const sum = sumMinor(val.allocations.map((a) => a.amountOwed ?? 0));
      if (sum !== val.amount) {
        ctx.addIssue({
          code: "custom",
          message: `Allocations must sum to ${val.amount} (got ${sum})`,
          path: ["allocations"],
        });
      }
    }
  }

  if (val.splitMethod === "percentage") {
    if (!val.allocations?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Percentage splits require allocations",
        path: ["allocations"],
      });
    } else {
      const pct = val.allocations.reduce((acc, a) => acc + (a.percentage ?? 0), 0);
      if (Math.abs(pct - 100) > 1e-6) {
        ctx.addIssue({
          code: "custom",
          message: `Percentages must sum to 100 (got ${pct})`,
          path: ["allocations"],
        });
      }
    }
  }

  if (val.splitMethod === "shares") {
    if (!val.allocations?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Shares splits require allocations",
        path: ["allocations"],
      });
    } else if (val.allocations.every((a) => !(a.shares && a.shares > 0))) {
      ctx.addIssue({
        code: "custom",
        message: "Shares must be positive",
        path: ["allocations"],
      });
    }
  }
}

export const createExpenseSchema =
  expenseFieldsSchema.superRefine(refineExpense);

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const patchExpenseSchema = expenseFieldsSchema.partial();

export function buildExpenseParts(
  input: CreateExpenseInput,
  baseCurrency: string,
) {
  const currency = input.currency ?? baseCurrency;
  const fxRateToBase =
    currency === baseCurrency ? 1 : (input.fxRateToBase ?? 1);
  if (currency !== baseCurrency && input.fxRateToBase == null) {
    throw new ApiError(
      400,
      "invalid_request",
      "fxRateToBase is required when currency differs from group base",
    );
  }

  const amountInBase = applyFx(input.amount, fxRateToBase);
  const payerInputs =
    input.payers ??
    (input.paidByUserId
      ? [{ userId: input.paidByUserId, amountPaid: input.amount }]
      : []);

  let shares;
  try {
    switch (input.splitMethod) {
      case "equal":
        shares = calculateEqualSplit(input.amount, input.participantIds);
        break;
      case "unequal":
        shares = calculateUnequalSplit(
          input.amount,
          (input.allocations ?? []).map((a) => ({
            userId: a.userId,
            amountOwed: a.amountOwed ?? 0,
          })),
        );
        break;
      case "percentage":
        shares = calculatePercentageSplit(
          input.amount,
          (input.allocations ?? []).map((a) => ({
            userId: a.userId,
            percentage: a.percentage ?? 0,
          })),
        );
        break;
      case "shares":
        shares = calculateSharesSplit(
          input.amount,
          (input.allocations ?? []).map((a) => ({
            userId: a.userId,
            shares: a.shares ?? 1,
          })),
        );
        break;
      default:
        throw new Error("Unsupported split method");
    }
  } catch (error) {
    throw new ApiError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid split",
    );
  }

  const allocationByUser = new Map(
    (input.allocations ?? []).map((a) => [a.userId, a]),
  );

  // Converted together, so what was paid and what is owed both add up to
  // amountInBase exactly and the group's balances still net to zero.
  const paidInBase = convertParts(payerInputs.map((p) => p.amountPaid), fxRateToBase);
  const owedInBase = convertParts(shares.map((s) => s.amountOwed), fxRateToBase);

  const payers = payerInputs.map((p, i) => ({
    userId: new Types.ObjectId(p.userId),
    amountPaid: p.amountPaid,
    amountPaidInBase: paidInBase[i]!,
  }));

  const splits = shares.map((s, i) => {
    const meta = allocationByUser.get(s.userId);
    return {
      userId: new Types.ObjectId(s.userId),
      amountOwed: s.amountOwed,
      amountOwedInBase: owedInBase[i]!,
      percentage: meta?.percentage ?? null,
      shares: meta?.shares ?? null,
    };
  });

  return {
    currency,
    fxRateToBase,
    amountInBase,
    payers,
    splits,
  };
}

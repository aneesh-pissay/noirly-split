"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  calculateEqualSplit,
  calculatePercentageSplit,
  calculateSharesSplit,
} from "@/src/core/splits";
import { sumMinor } from "@/src/core/money";
import { qk } from "@/src/core/sync/query-keys";
import type { Expense, ExpenseSplit, SplitMethod } from "@/src/core/models/types";
import {
  MoneyText,
  parseMajorToMinor,
  todayISODate,
} from "@/src/components/MoneyText";
import { Button, Input, Label, Textarea } from "@noirly-dev/ui";
import { api, type CreateExpenseBody } from "@/src/lib/api-client";
import { ExpensePresence } from "@/src/features/realtime/ExpensePresence";

const CATEGORIES = [
  { value: "", label: "None" },
  { value: "food", label: "Food" },
  { value: "travel", label: "Travel" },
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "other", label: "Other" },
] as const;

const METHODS: SplitMethod[] = ["equal", "unequal", "percentage", "shares"];

type Props = {
  groupId: string;
  baseCurrency: string;
  currentUserId: string;
  initial?: Expense | null;
};

function majorFromMinor(n: number): string {
  return (n / 100).toFixed(2);
}

export function ExpenseForm({
  groupId,
  baseCurrency,
  currentUserId,
  initial = null,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(initial);
  const members = useQuery({
    queryKey: qk.members(groupId),
    queryFn: () => api.listMembers(groupId),
  });

  const [description, setDescription] = useState(initial?.description ?? "");
  const [amountMajor, setAmountMajor] = useState(
    initial ? majorFromMinor(initial.amount) : "",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency);
  const [fxRate, setFxRate] = useState(String(initial?.fxRateToBase ?? "1"));
  const [date, setDate] = useState(initial?.date ?? todayISODate());
  const [category, setCategory] = useState(initial?.category ?? "");
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(
    initial?.splitMethod ?? "equal",
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    if (!initial) return {};
    return Object.fromEntries(
      initial.splits.map((s) => [s.userId, true]),
    );
  });
  const [unequal, setUnequal] = useState<Record<string, string>>(() => {
    if (!initial || initial.splitMethod !== "unequal") return {};
    return Object.fromEntries(
      initial.splits.map((s) => [s.userId, majorFromMinor(s.amountOwed)]),
    );
  });
  const [percentages, setPercentages] = useState<Record<string, string>>(() => {
    if (!initial || initial.splitMethod !== "percentage") return {};
    return Object.fromEntries(
      initial.splits.map((s) => [s.userId, String(s.percentage ?? "")]),
    );
  });
  const [shares, setShares] = useState<Record<string, string>>(() => {
    if (!initial || initial.splitMethod !== "shares") return {};
    return Object.fromEntries(
      initial.splits.map((s) => [s.userId, String(s.shares ?? "1")]),
    );
  });
  const [payers, setPayers] = useState<Array<{ userId: string; amount: string }>>(
    () => {
      if (initial?.payers?.length) {
        return initial.payers.map((p) => ({
          userId: p.userId,
          amount: majorFromMinor(p.amountPaid),
        }));
      }
      return [{ userId: currentUserId, amount: "" }];
    },
  );
  const [receiptUrl, setReceiptUrl] = useState<string | null>(
    initial?.receiptUrl ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberList = members.data?.members ?? [];
  const participantIds = memberList
    .filter((m) => selected[m.userId] !== false)
    .map((m) => m.userId);
  const amountMinor = parseMajorToMinor(amountMajor);

  const preview = useMemo(() => {
    if (amountMinor == null || participantIds.length === 0) return [];
    try {
      if (splitMethod === "equal") {
        return calculateEqualSplit(amountMinor, participantIds);
      }
      if (splitMethod === "percentage") {
        return calculatePercentageSplit(
          amountMinor,
          participantIds.map((userId) => ({
            userId,
            percentage: Number(percentages[userId] ?? 0),
          })),
        );
      }
      if (splitMethod === "shares") {
        return calculateSharesSplit(
          amountMinor,
          participantIds.map((userId) => ({
            userId,
            shares: Number(shares[userId] ?? 1) || 1,
          })),
        );
      }
      return participantIds.map((userId) => ({
        userId,
        amountOwed: parseMajorToMinor(unequal[userId] ?? "") ?? 0,
      }));
    } catch {
      return participantIds.map((userId) => ({ userId, amountOwed: 0 }));
    }
  }, [
    amountMinor,
    participantIds,
    splitMethod,
    unequal,
    percentages,
    shares,
  ]);

  const payerMinors = payers.map((p) => ({
    userId: p.userId,
    amountPaid: parseMajorToMinor(p.amount || amountMajor) ?? 0,
  }));
  // When single payer and amount empty on payer row, use total
  const resolvedPayers =
    payers.length === 1
      ? [
          {
            userId: payers[0]!.userId,
            amountPaid: amountMinor ?? 0,
          },
        ]
      : payerMinors;

  const payersValid =
    amountMinor != null &&
    sumMinor(resolvedPayers.map((p) => p.amountPaid)) === amountMinor;

  const splitValid = (() => {
    if (amountMinor == null) return false;
    if (splitMethod === "equal") return true;
    if (splitMethod === "unequal") {
      return sumMinor(preview.map((p) => p.amountOwed)) === amountMinor;
    }
    if (splitMethod === "percentage") {
      const pct = participantIds.reduce(
        (acc, id) => acc + Number(percentages[id] ?? 0),
        0,
      );
      return Math.abs(pct - 100) < 1e-6;
    }
    return participantIds.every((id) => Number(shares[id] ?? 1) > 0);
  })();

  const mutation = useMutation({
    mutationFn: (body: CreateExpenseBody) =>
      editing && initial
        ? api.updateExpense(groupId, initial.id, body)
        : api.createExpense(groupId, body),
    onMutate: async (body) => {
      if (editing) return;
      await queryClient.cancelQueries({ queryKey: qk.expenses(groupId) });
      const previous = queryClient.getQueryData<{ expenses: Expense[] }>(
        qk.expenses(groupId),
      );
      const tempId = `temp-${Date.now()}`;
      const splitRows: ExpenseSplit[] = preview.map((s) => ({
        userId: s.userId,
        amountOwed: s.amountOwed,
        amountOwedInBase: s.amountOwed,
        percentage: null,
        shares: null,
      }));
      const optimistic: Expense = {
        id: tempId,
        groupId,
        amount: body.amount,
        currency: body.currency ?? baseCurrency,
        fxRateToBase: body.fxRateToBase ?? 1,
        amountInBase: body.amount,
        description: body.description,
        date: body.date,
        category: body.category ?? null,
        receiptUrl: body.receiptUrl ?? null,
        splitMethod: body.splitMethod,
        createdBy: currentUserId,
        isRecurring: Boolean(body.isRecurring),
        recurrenceRule: null,
        recurrenceParentId: null,
        payers: (body.payers ?? []).map((p) => ({
          userId: p.userId,
          amountPaid: p.amountPaid,
          amountPaidInBase: p.amountPaid,
        })),
        splits: splitRows,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      queryClient.setQueryData<{ expenses: Expense[] }>(qk.expenses(groupId), {
        expenses: [optimistic, ...(previous?.expenses ?? [])],
      });
      return { previous, tempId };
    },
    onError: (err, _body, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(qk.expenses(groupId), ctx.previous);
      }
      setError((err as Error).message);
    },
    onSuccess: async (data, _body, ctx) => {
      if (!editing) {
        queryClient.setQueryData<{ expenses: Expense[] }>(
          qk.expenses(groupId),
          (old) => {
            const list = old?.expenses ?? [];
            return {
              expenses: [
                data.expense,
                ...list.filter(
                  (e) => e.id !== ctx?.tempId && e.id !== data.expense.id,
                ),
              ],
            };
          },
        );
      } else {
        queryClient.setQueryData(qk.expense(data.expense.id), data);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.expenses(groupId) }),
        queryClient.invalidateQueries({ queryKey: qk.balances(groupId) }),
        queryClient.invalidateQueries({ queryKey: qk.activity(groupId) }),
        queryClient.invalidateQueries({ queryKey: qk.dashboardBalances() }),
      ]);
      router.push(`/g/${groupId}/expenses/${data.expense.id}`);
    },
  });

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadReceipt(groupId, file);
      setReceiptUrl(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (amountMinor == null || amountMinor <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    if (participantIds.length === 0) {
      setError("Select at least one participant");
      return;
    }
    if (!payersValid) {
      setError("Payer amounts must sum to the total");
      return;
    }
    if (!splitValid) {
      setError("Split amounts are invalid");
      return;
    }
    const needsFx = currency.toUpperCase() !== baseCurrency;
    const rate = Number(fxRate);
    if (needsFx && (!Number.isFinite(rate) || rate <= 0)) {
      setError("Enter a positive FX rate to base currency");
      return;
    }

    mutation.mutate({
      amount: amountMinor,
      currency: currency.toUpperCase(),
      fxRateToBase: needsFx ? rate : 1,
      description: description.trim(),
      date,
      category: (category || null) as CreateExpenseBody["category"],
      receiptUrl,
      payers: resolvedPayers,
      splitMethod,
      participantIds,
      allocations:
        splitMethod === "equal"
          ? undefined
          : participantIds.map((userId) => ({
              userId,
              amountOwed:
                splitMethod === "unequal"
                  ? (parseMajorToMinor(unequal[userId] ?? "") ?? 0)
                  : undefined,
              percentage:
                splitMethod === "percentage"
                  ? Number(percentages[userId] ?? 0)
                  : undefined,
              shares:
                splitMethod === "shares"
                  ? Number(shares[userId] ?? 1)
                  : undefined,
            })),
      isRecurring: false,
      recurrence: null,
    });
  }

  const nameOf = (userId: string) =>
    memberList.find((m) => m.userId === userId)?.displayName ?? "Member";

  return (
    <form
      className="flex w-full flex-col gap-5 rounded-[var(--r-lg)] border border-[var(--hairline)] bg-[var(--surface)] p-5"
      onSubmit={onSubmit}
    >
      <ExpensePresence groupId={groupId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="expense-description">Description</Label>
        <Textarea
          id="expense-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
          required
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-amount">Amount</Label>
          <Input
            id="expense-amount"
            className="font-mono"
            inputMode="decimal"
            placeholder="0.00"
            value={amountMajor}
            onChange={(e) => {
              setAmountMajor(e.target.value);
              if (payers.length === 1) {
                setPayers([{ ...payers[0]!, amount: e.target.value }]);
              }
            }}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-currency">Currency</Label>
          <Input
            id="expense-currency"
            className="font-mono uppercase"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
      </div>

      {currency.toUpperCase() !== baseCurrency ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-fx">FX rate → {baseCurrency} (locked at entry)</Label>
          <Input
            id="expense-fx"
            className="font-mono"
            value={fxRate}
            onChange={(e) => setFxRate(e.target.value)}
          />
          {amountMinor != null && Number(fxRate) > 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              ≈{" "}
              <MoneyText
                amount={Math.round(amountMinor * Number(fxRate))}
                currency={baseCurrency}
              />
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-date">Date</Label>
          <Input
            id="expense-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-category">Category</Label>
          <select
            id="expense-category"
            className="flex h-10 w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground">
          Paid by
        </legend>
        {payers.map((p, idx) => (
          <div key={`${p.userId}-${idx}`} className="flex gap-2">
            <select
              className="h-11 flex-1 border border border-[var(--hairline)] bg-transparent px-3 outline-none"
              value={p.userId}
              onChange={(e) => {
                const next = [...payers];
                next[idx] = { ...p, userId: e.target.value };
                setPayers(next);
              }}
            >
              {memberList.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email}
                </option>
              ))}
            </select>
            {payers.length > 1 ? (
              <input
                className="h-11 w-28 border border border-[var(--hairline)] bg-transparent px-2 font-mono outline-none"
                inputMode="decimal"
                placeholder="0.00"
                value={p.amount}
                onChange={(e) => {
                  const next = [...payers];
                  next[idx] = { ...p, amount: e.target.value };
                  setPayers(next);
                }}
              />
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="self-start font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground hover:text-foreground"
          onClick={() =>
            setPayers((prev) => [
              ...prev,
              { userId: memberList[0]?.userId ?? currentUserId, amount: "" },
            ])
          }
        >
          + Add payer
        </button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground">
          Split method
        </legend>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={`h-10 px-3 font-mono text-[11px] tracking-[0.14em] uppercase border border-dashed ${
                splitMethod === method
                  ? "border-solid bg-[var(--surface-2)] text-[var(--accent-ink)]"
                  : "border-[var(--hairline)]"
              }`}
              onClick={() => setSplitMethod(method)}
            >
              {method}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground">
          Participants
        </legend>
        <ul className="divide-y divide-dashed divide-[var(--hairline)] border border border-[var(--hairline)]">
          {memberList.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected[m.userId] !== false}
                  onChange={() =>
                    setSelected((prev) => ({
                      ...prev,
                      [m.userId]: !(prev[m.userId] !== false),
                    }))
                  }
                />
                <span>{m.displayName ?? m.email}</span>
              </label>
              {selected[m.userId] !== false && splitMethod === "unequal" ? (
                <input
                  className="h-9 w-24 border border border-[var(--hairline)] bg-transparent px-2 font-mono text-sm outline-none"
                  inputMode="decimal"
                  value={unequal[m.userId] ?? ""}
                  onChange={(e) =>
                    setUnequal((prev) => ({
                      ...prev,
                      [m.userId]: e.target.value,
                    }))
                  }
                />
              ) : null}
              {selected[m.userId] !== false && splitMethod === "percentage" ? (
                <input
                  className="h-9 w-20 border border border-[var(--hairline)] bg-transparent px-2 font-mono text-sm outline-none"
                  inputMode="decimal"
                  placeholder="%"
                  value={percentages[m.userId] ?? ""}
                  onChange={(e) =>
                    setPercentages((prev) => ({
                      ...prev,
                      [m.userId]: e.target.value,
                    }))
                  }
                />
              ) : null}
              {selected[m.userId] !== false && splitMethod === "shares" ? (
                <input
                  className="h-9 w-20 border border border-[var(--hairline)] bg-transparent px-2 font-mono text-sm outline-none"
                  inputMode="numeric"
                  placeholder="shares"
                  value={shares[m.userId] ?? "1"}
                  onChange={(e) =>
                    setShares((prev) => ({
                      ...prev,
                      [m.userId]: e.target.value,
                    }))
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>

      {preview.length > 0 && amountMinor != null ? (
        <div
          className="border border border-[var(--hairline)] px-4 py-3"
          aria-live="polite"
        >
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground">
            Split preview
          </p>
          <ul className="mt-2 space-y-1">
            {preview.map((p) => (
              <li key={p.userId} className="flex justify-between text-sm">
                <span>{nameOf(p.userId)}</span>
                <MoneyText
                  amount={p.amountOwed}
                  currency={currency || baseCurrency}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground-foreground">
          Receipt photo
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
          }}
        />
        {uploading ? (
          <span className="text-sm text-muted-foreground-foreground">Uploading…</span>
        ) : null}
        {receiptUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={receiptUrl}
            alt="Receipt"
            className="mt-2 max-h-40 border border border-[var(--hairline)] object-contain"
          />
        ) : null}
      </label>

      {error ? (
        <p className="text-balance-negative" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={mutation.isPending || !splitValid || !payersValid}
      >
        {mutation.isPending
          ? "Saving…"
          : editing
            ? "Save changes"
            : "Add expense"}
      </Button>
    </form>
  );
}

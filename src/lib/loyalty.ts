import type { LoyaltyAccountRow, LoyaltyEntryRow, LoyaltyKind } from "@/lib/database.types";
import { getCashbackRate } from "@/lib/admin";
import { supabase } from "@/lib/supabase";

export const CASHBACK_RATE = 0.05;
const STORAGE_KEY = "ari-gnank-loyalty";

export type LoyaltyEntry = {
  id: string;
  tourId: string;
  tourTitle: string;
  kind: LoyaltyKind;
  points: number;
  note: string;
  createdAt: string;
};

export type PromoCredit = {
  id: string;
  code: string;
  amount: number;
  createdAt: string;
};

export type LoyaltyAccount = {
  phone: string;
  fullName: string;
  points: number;
  history: LoyaltyEntry[];
  credits: PromoCredit[];
};

type LoyaltyState = {
  accounts: Record<string, LoyaltyAccount>;
  lastPhone: string;
};

const emptyState: LoyaltyState = { accounts: {}, lastPhone: "" };
let state: LoyaltyState = emptyState;
let hydrated = false;
const listeners = new Set<() => void>();

export function phoneKey(phone: string) {
  return phone.replace(/\D/g, "");
}

export function quoteCheckout(balance: number, total: number, usePoints: boolean, rate = getCashbackRate()) {
  const safeTotal = Math.max(0, Math.round(total));
  const safeBalance = Math.max(0, Math.round(balance));
  const safeRate = Math.min(1, Math.max(0, rate));
  const maxRedeem = Math.min(safeBalance, safeTotal);
  const redeem = usePoints ? maxRedeem : 0;
  const payable = Math.max(0, safeTotal - redeem);
  const earn = Math.floor(payable * safeRate);
  return { redeem, payable, earn, maxRedeem, cashbackPercent: Math.round(safeRate * 100) };
}

function creditsOf(value: unknown): PromoCredit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const credit = item as Partial<PromoCredit>;
    if (typeof credit.id !== "string" || typeof credit.code !== "string" || typeof credit.amount !== "number") return [];
    const amount = Math.max(0, Math.round(credit.amount));
    if (amount < 1) return [];
    return [
      {
        id: credit.id,
        code: credit.code,
        amount,
        createdAt: typeof credit.createdAt === "string" ? credit.createdAt : "",
      },
    ];
  });
}

function withCredits(account: LoyaltyAccount, credits = creditsOf(account.credits)): LoyaltyAccount {
  return { ...account, credits };
}

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setState(next: LoyaltyState) {
  state = next;
  persist();
  emit();
}

export function hydrateLoyalty() {
  if (hydrated || typeof localStorage === "undefined") return;
  hydrated = true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as LoyaltyState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.accounts !== "object") return;
    const accounts: Record<string, LoyaltyAccount> = {};
    for (const [key, account] of Object.entries(parsed.accounts)) {
      if (!account || typeof account !== "object") continue;
      accounts[key] = withCredits(account);
    }
    state = {
      accounts,
      lastPhone: typeof parsed.lastPhone === "string" ? parsed.lastPhone : "",
    };
    emit();
  } catch {
    /* Ignore a damaged local wallet and start from zero. */
  }
}

export function subscribeLoyalty(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoyaltySnapshot() {
  return state;
}

export function getLoyaltyServerSnapshot() {
  return emptyState;
}

export function accountForPhone(phone: string) {
  const key = phoneKey(phone);
  if (!key) return null;
  return state.accounts[key] ?? null;
}

function remember(account: LoyaltyAccount) {
  setState({
    accounts: { ...state.accounts, [account.phone]: withCredits(account) },
    lastPhone: account.phone,
  });
}

function mapEntry(entry: LoyaltyEntryRow): LoyaltyEntry {
  return {
    id: entry.id,
    tourId: entry.tourId ?? "",
    tourTitle: entry.tourTitle ?? "",
    kind: entry.kind,
    points: entry.points,
    note: entry.note,
    createdAt: entry.createdAt,
  };
}

function mapAccount(row: LoyaltyAccountRow): LoyaltyAccount {
  return {
    phone: row.phone,
    fullName: row.full_name,
    points: row.points,
    history: (row.history ?? []).map(mapEntry),
    credits: creditsOf(state.accounts[row.phone]?.credits),
  };
}

export async function loadLoyalty(phone: string) {
  const key = phoneKey(phone);
  if (key.length < 8) throw new Error("Գրեք գործող հեռախոսահամար։");
  if (!supabase) {
    const existing = state.accounts[key];
    const account = existing ?? { phone: key, fullName: "", points: 0, history: [], credits: [] };
    setState({ ...state, lastPhone: key });
    return account;
  }
  const { data, error } = await supabase.rpc("get_loyalty", { p_phone: key });
  if (error || !data) throw new Error("Միավորները չբեռնվեցին։");
  const account = mapAccount(data);
  remember(account);
  return account;
}

export async function commitLoyalty(input: {
  phone: string;
  fullName: string;
  redeem: number;
  earn: number;
  tourId: string;
  tourTitle: string;
  cashbackPercent: number;
}) {
  const key = phoneKey(input.phone);
  if (key.length < 8) throw new Error("Հեռախոսահամարը պակաս է։");
  const cashbackPercent = Math.min(100, Math.max(0, Math.round(input.cashbackPercent)));
  if (!supabase) return commitLocal({ ...input, phone: key, cashbackPercent });

  const { data, error } = await supabase.rpc("apply_loyalty", {
    p_phone: key,
    p_name: input.fullName.trim(),
    p_redeem: input.redeem,
    p_earn: input.earn,
    p_tour_id: input.tourId,
    p_tour_title: input.tourTitle,
    p_cashback_percent: cashbackPercent,
  });
  if (error || !data) throw new Error(error?.message || "Միավորները չպահպանվեցին։");
  const account = mapAccount(data);
  remember(account);
  return account;
}

export async function revertLoyalty(input: {
  phone: string;
  previous: LoyaltyAccount | null;
  redeem: number;
  earn: number;
  tourId: string;
}) {
  const key = phoneKey(input.phone);
  if (!key) return;
  if (!supabase) {
    if (input.previous) {
      remember(input.previous);
      return;
    }
    const accounts = { ...state.accounts };
    delete accounts[key];
    setState({ accounts, lastPhone: state.lastPhone === key ? "" : state.lastPhone });
    return;
  }

  const { data, error } = await supabase.rpc("revert_loyalty", {
    p_phone: key,
    p_redeem: input.redeem,
    p_earn: input.earn,
    p_tour_id: input.tourId,
  });
  if (error || !data) throw new Error(error?.message || "Միավորները չվերականգնվեցին։");
  remember(mapAccount(data));
}

export async function adjustLoyaltyPoints(input: { phone: string; fullName: string; delta: number }) {
  const key = phoneKey(input.phone);
  const delta = Math.trunc(input.delta);
  if (key.length < 8) throw new Error("Հեռախոսահամարը պակաս է։");
  if (!Number.isFinite(delta) || delta === 0) throw new Error("Գրեք միավորների քանակը։");
  hydrateLoyalty();
  if (supabase) {
    return commitLoyalty({
      phone: key,
      fullName: input.fullName,
      redeem: delta < 0 ? Math.abs(delta) : 0,
      earn: delta > 0 ? delta : 0,
      tourId: "admin",
      tourTitle: "Ադմինի ուղղում",
      cashbackPercent: 0,
    });
  }
  const current = state.accounts[key] ?? {
    phone: key,
    fullName: input.fullName.trim(),
    points: 0,
    history: [],
    credits: [],
  };
  if (current.points + delta < 0) throw new Error("Միավորները բավարար չեն։");
  const account: LoyaltyAccount = {
    phone: key,
    fullName: input.fullName.trim() || current.fullName,
    points: current.points + delta,
    history: [
      {
        id: crypto.randomUUID(),
        tourId: "admin",
        tourTitle: "Ադմինի ուղղում",
        kind: delta > 0 ? "earn" : "redeem",
        points: Math.abs(delta),
        note: delta > 0 ? "Ադմինի ավելացում" : "Ադմինի նվազեցում",
        createdAt: new Date().toISOString(),
      },
      ...current.history,
    ],
    credits: current.credits,
  };
  remember(account);
  return account;
}

function commitLocal(input: {
  phone: string;
  fullName: string;
  redeem: number;
  earn: number;
  tourId: string;
  tourTitle: string;
  cashbackPercent: number;
}) {
  const current = state.accounts[input.phone] ?? {
    phone: input.phone,
    fullName: input.fullName.trim(),
    points: 0,
    history: [],
    credits: [],
  };
  if (input.redeem > current.points) throw new Error("Միավորները բավարար չեն։");
  const now = new Date().toISOString();
  const history = [...current.history];
  if (input.redeem > 0) {
    history.unshift({
      id: crypto.randomUUID(),
      tourId: input.tourId,
      tourTitle: input.tourTitle,
      kind: "redeem",
      points: input.redeem,
      note: `Զեղչ՝ ${input.tourTitle}`,
      createdAt: now,
    });
  }
  if (input.earn > 0) {
    history.unshift({
      id: crypto.randomUUID(),
      tourId: input.tourId,
      tourTitle: input.tourTitle,
      kind: "earn",
      points: input.earn,
      note: `${input.cashbackPercent}% հետվճար՝ ${input.tourTitle}`,
      createdAt: now,
    });
  }
  const account: LoyaltyAccount = {
    phone: input.phone,
    fullName: input.fullName.trim() || current.fullName,
    points: current.points - input.redeem + input.earn,
    history,
    credits: creditsOf(current.credits),
  };
  remember(account);
  return account;
}

export function activeCreditTotal(phone: string) {
  const account = accountForPhone(phone);
  return creditsOf(account?.credits).reduce((sum, credit) => sum + credit.amount, 0);
}

export async function issuePromoCredit(input: { phone: string; fullName: string; points: number }) {
  const key = phoneKey(input.phone);
  const points = Math.trunc(input.points);
  if (key.length < 8) throw new Error("Հեռախոսահամարը պակաս է։");
  if (!Number.isFinite(points) || points < 1) throw new Error("Գրեք փոխարինվող միավորները։");
  hydrateLoyalty();
  const balance = state.accounts[key]?.points ?? 0;
  if (points > balance) throw new Error("Միավորները բավարար չեն։");
  const code = `AG-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const credit: PromoCredit = {
    id: crypto.randomUUID(),
    code,
    amount: points,
    createdAt: new Date().toISOString(),
  };
  await commitLoyalty({
    phone: key,
    fullName: input.fullName,
    redeem: points,
    earn: 0,
    tourId: "credit",
    tourTitle: `Զեղչի կտրոն ${code}`,
    cashbackPercent: 0,
  });
  const current = state.accounts[key];
  if (!current) throw new Error("Զեղչի կտրոնը չպահվեց։");
  const account = withCredits(current, [credit, ...creditsOf(current.credits)]);
  remember(account);
  return { account, credit };
}

export function takePromoCredits(phone: string, amount: number) {
  const key = phoneKey(phone);
  const account = state.accounts[key];
  const requested = Math.max(0, Math.round(amount));
  if (!account || requested < 1) return { applied: 0, restore: () => undefined };
  const before = creditsOf(account.credits);
  let left = requested;
  let applied = 0;
  const next: PromoCredit[] = [];
  for (const credit of before) {
    if (left < 1) {
      next.push(credit);
      continue;
    }
    if (credit.amount <= left) {
      applied += credit.amount;
      left -= credit.amount;
      continue;
    }
    applied += left;
    next.push({ ...credit, amount: credit.amount - left });
    left = 0;
  }
  remember(withCredits(account, next));
  return {
    applied,
    restore: () => {
      const current = state.accounts[key];
      if (!current) return;
      remember(withCredits(current, before));
    },
  };
}

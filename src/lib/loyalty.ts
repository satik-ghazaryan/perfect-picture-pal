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

export type LoyaltyAccount = {
  phone: string;
  fullName: string;
  points: number;
  history: LoyaltyEntry[];
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
    state = {
      accounts: parsed.accounts,
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
    accounts: { ...state.accounts, [account.phone]: account },
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
  };
}

export async function loadLoyalty(phone: string) {
  const key = phoneKey(phone);
  if (key.length < 8) throw new Error("Գրեք գործող հեռախոսահամար։");
  if (!supabase) {
    const existing = state.accounts[key];
    const account = existing ?? { phone: key, fullName: "", points: 0, history: [] };
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
  };
  remember(account);
  return account;
}

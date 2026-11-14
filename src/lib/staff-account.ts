export type StaffRole = "guide" | "driver";

export type StaffAccountInput = {
  role: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  avatarUrl: string;
  bio: string;
};

export type StaffAccountDraft = {
  role: StaffRole;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  avatarUrl: string;
  bio: string;
};

export type StaffAccountRecord = {
  id: string;
  role: StaffRole;
  fullName: string;
  phone: string;
  email: string;
  avatarUrl: string;
  bio: string;
};

export type StaffCreateResult =
  | { ok: true; account: StaffAccountRecord }
  | { ok: false; code: "invalid" | "duplicate" | "profile_failed"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeStaffAccountInput(
  input: StaffAccountInput,
): { ok: true; value: StaffAccountDraft } | { ok: false; message: string } {
  const role = input.role === "guide" || input.role === "driver" ? input.role : null;
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  const digits = phone.replace(/\D/g, "");
  if (!role) return { ok: false, message: "Ընտրեք զբոսավար կամ վարորդ։" };
  if (fullName.length < 2) return { ok: false, message: "Գրեք անունը և ազգանունը։" };
  if (digits.length < 8 || digits.length > 15)
    return { ok: false, message: "Գրեք գործող հեռախոսահամար։" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, message: "Գրեք գործող էլ. փոստ։" };
  if (input.password.length < 6)
    return { ok: false, message: "Գաղտնաբառը առնվազն 6 նիշ պետք է լինի։" };
  return {
    ok: true,
    value: {
      role,
      fullName,
      phone,
      email,
      password: input.password,
      avatarUrl: input.avatarUrl.trim(),
      bio: input.bio.trim(),
    },
  };
}

export function isDuplicateStaffAuthError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("already") ||
    text.includes("duplicate") ||
    text.includes("email_exists") ||
    text.includes("registered")
  );
}

export async function createStaffAccountRecord(
  input: StaffAccountInput,
  deps: {
    createAuth: (value: StaffAccountDraft) => Promise<{ id: string }>;
    saveProfile: (account: StaffAccountRecord) => Promise<void>;
    deleteAuth: (id: string) => Promise<void>;
  },
): Promise<StaffCreateResult> {
  const normalized = normalizeStaffAccountInput(input);
  if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message };
  let created: { id: string };
  try {
    created = await deps.createAuth(normalized.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isDuplicateStaffAuthError(message)) {
      return { ok: false, code: "duplicate", message: "Այս էլ. փոստով հաշիվ արդեն կա։" };
    }
    return {
      ok: false,
      code: "profile_failed",
      message: "Հաշիվը չստեղծվեց։ Կրկնեք գործողությունը։",
    };
  }
  const account: StaffAccountRecord = {
    id: created.id,
    role: normalized.value.role,
    fullName: normalized.value.fullName,
    phone: normalized.value.phone,
    email: normalized.value.email,
    avatarUrl: normalized.value.avatarUrl,
    bio: normalized.value.bio,
  };
  try {
    await deps.saveProfile(account);
  } catch {
    try {
      await deps.deleteAuth(created.id);
    } catch {
      /* The auth row could not be removed. Retry must not adopt it. */
    }
    return {
      ok: false,
      code: "profile_failed",
      message: "Հաշիվը չստեղծվեց։ Կրկնեք գործողությունը։",
    };
  }
  return { ok: true, account };
}

export type StaffUpdateInput = Omit<StaffAccountInput, "password"> & {
  id: string;
  password: string;
};

export type StaffUpdateResult =
  | { ok: true; account: StaffAccountRecord }
  | { ok: false; code: "invalid" | "not_staff" | "duplicate" | "failed"; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Change an existing guide or driver. The sign-in email and password live in Supabase Auth,
 * so they are changed there; an empty password keeps the current one. Only accounts that are
 * already guide or driver can be changed here, so this cannot be used to take over an admin
 * or a tourist account.
 */
export async function updateStaffAccountRecord(
  input: StaffUpdateInput,
  deps: {
    loadProfile: (id: string) => Promise<{ role: string; email: string } | null>;
    updateAuth: (id: string, change: { email?: string; password?: string }) => Promise<void>;
    saveProfile: (account: StaffAccountRecord) => Promise<void>;
  },
): Promise<StaffUpdateResult> {
  if (!UUID_PATTERN.test(input.id)) {
    return { ok: false, code: "invalid", message: "Անձնակազմի հաշիվը չի գտնվել։" };
  }
  const keepsPassword = input.password.length === 0;
  const normalized = normalizeStaffAccountInput({
    ...input,
    password: keepsPassword ? "unchanged-password" : input.password,
  });
  if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message };
  let current: { role: string; email: string } | null;
  try {
    current = await deps.loadProfile(input.id);
  } catch {
    return { ok: false, code: "failed", message: "Տվյալները չպահվեցին։ Կրկնեք գործողությունը։" };
  }
  if (!current || (current.role !== "guide" && current.role !== "driver")) {
    return {
      ok: false,
      code: "not_staff",
      message: "Այստեղ կարելի է փոխել միայն զբոսավարի կամ վարորդի հաշիվը։",
    };
  }
  const change: { email?: string; password?: string } = {};
  if (normalized.value.email !== current.email.trim().toLowerCase()) {
    change.email = normalized.value.email;
  }
  if (!keepsPassword) change.password = input.password;
  if (change.email !== undefined || change.password !== undefined) {
    try {
      await deps.updateAuth(input.id, change);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (isDuplicateStaffAuthError(message)) {
        return { ok: false, code: "duplicate", message: "Այս էլ. փոստով հաշիվ արդեն կա։" };
      }
      return {
        ok: false,
        code: "failed",
        message: "Մուտքի տվյալները չփոխվեցին։ Կրկնեք գործողությունը։",
      };
    }
  }
  const account: StaffAccountRecord = {
    id: input.id,
    role: normalized.value.role,
    fullName: normalized.value.fullName,
    phone: normalized.value.phone,
    email: normalized.value.email,
    avatarUrl: normalized.value.avatarUrl,
    bio: normalized.value.bio,
  };
  try {
    await deps.saveProfile(account);
  } catch {
    return { ok: false, code: "failed", message: "Տվյալները չպահվեցին։ Կրկնեք գործողությունը։" };
  }
  return { ok: true, account };
}

export type StaffActiveResult =
  | { ok: true; id: string; active: boolean }
  | { ok: false; code: "invalid" | "not_staff" | "failed"; message: string };

/**
 * Switch a guide's or driver's sign-in off or back on. Switching it off also takes the person
 * off upcoming departures, so a tour is not left with a crew member who cannot sign in.
 * Nothing is deleted: past tours keep their history and the account can be switched on again.
 */
export async function setStaffAccountActive(
  input: { id: string; active: boolean },
  deps: {
    loadProfile: (id: string) => Promise<{ role: string } | null>;
    setSignIn: (id: string, allowed: boolean) => Promise<void>;
    clearUpcoming: (id: string) => Promise<void>;
  },
): Promise<StaffActiveResult> {
  if (!UUID_PATTERN.test(input.id)) {
    return { ok: false, code: "invalid", message: "Անձնակազմի հաշիվը չի գտնվել։" };
  }
  let current: { role: string } | null;
  try {
    current = await deps.loadProfile(input.id);
  } catch {
    return { ok: false, code: "failed", message: "Հաշիվը չփոխվեց։ Կրկնեք գործողությունը։" };
  }
  if (!current || (current.role !== "guide" && current.role !== "driver")) {
    return {
      ok: false,
      code: "not_staff",
      message: "Այստեղ կարելի է անջատել միայն զբոսավարի կամ վարորդի հաշիվը։",
    };
  }
  try {
    await deps.setSignIn(input.id, input.active);
  } catch {
    return { ok: false, code: "failed", message: "Հաշիվը չփոխվեց։ Կրկնեք գործողությունը։" };
  }
  if (!input.active) {
    try {
      await deps.clearUpcoming(input.id);
    } catch {
      return {
        ok: false,
        code: "failed",
        message:
          "Մուտքն անջատվեց, բայց առաջիկա մեկնումներից հանել չստացվեց։ Կրկնեք գործողությունը։",
      };
    }
  }
  return { ok: true, id: input.id, active: input.active };
}

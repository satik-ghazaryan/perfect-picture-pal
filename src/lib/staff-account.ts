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

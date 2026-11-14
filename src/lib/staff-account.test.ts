import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaffAccountRecord, updateStaffAccountRecord } from "./staff-account";

const valid = {
  role: "guide",
  fullName: "Անի Սարգսյան",
  phone: "+37491111000",
  email: "guide@example.test",
  password: "phase2-pass",
  avatarUrl: "",
  bio: "",
};

describe("staff account creation", () => {
  it("rejects roles other than guide and driver", async () => {
    const result = await createStaffAccountRecord(
      { ...valid, role: "admin" },
      {
        createAuth: async () => {
          throw new Error("should not create");
        },
        saveProfile: async () => undefined,
        deleteAuth: async () => undefined,
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid");
  });

  it("does not adopt an existing email", async () => {
    let created = 0;
    const result = await createStaffAccountRecord(valid, {
      createAuth: async () => {
        created += 1;
        throw new Error("A user with this email address has already been registered");
      },
      saveProfile: async () => undefined,
      deleteAuth: async () => undefined,
    });
    assert.equal(created, 1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "duplicate");
  });

  it("does not report success when the profile write fails and removes the new auth user", async () => {
    const deleted: string[] = [];
    const result = await createStaffAccountRecord(valid, {
      createAuth: async () => ({ id: "auth-1" }),
      saveProfile: async () => {
        throw new Error("profile write failed");
      },
      deleteAuth: async (id) => {
        deleted.push(id);
      },
    });
    assert.deepEqual(deleted, ["auth-1"]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "profile_failed");
  });

  it("returns the account without the password", async () => {
    const result = await createStaffAccountRecord(valid, {
      createAuth: async () => ({ id: "auth-2" }),
      saveProfile: async () => undefined,
      deleteAuth: async () => undefined,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.account.id, "auth-2");
      assert.equal(result.account.role, "guide");
      assert.equal("password" in result.account, false);
    }
  });
});

describe("staff account editing", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const edit = { ...valid, id, password: "" };
  const deps = (profile: { role: string; email: string } | null) => {
    const calls: { auth: { email?: string; password?: string }[]; saved: unknown[] } = {
      auth: [],
      saved: [],
    };
    return {
      calls,
      deps: {
        loadProfile: async () => profile,
        updateAuth: async (_: string, change: { email?: string; password?: string }) => {
          calls.auth.push(change);
        },
        saveProfile: async (account: unknown) => {
          calls.saved.push(account);
        },
      },
    };
  };

  it("saves the name without touching the sign-in when email and password are unchanged", async () => {
    const { calls, deps: d } = deps({ role: "guide", email: "Guide@Example.test" });
    const result = await updateStaffAccountRecord({ ...edit, fullName: " Անի Պետրոսյան " }, d);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.auth, []);
    assert.equal((calls.saved[0] as { fullName: string }).fullName, "Անի Պետրոսյան");
  });

  it("changes the sign-in email and password in auth, not only in the profile", async () => {
    const { calls, deps: d } = deps({ role: "guide", email: "old@example.test" });
    const result = await updateStaffAccountRecord({ ...edit, password: "new-secret" }, d);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.auth, [{ email: "guide@example.test", password: "new-secret" }]);
  });

  it("refuses a short new password and an account that is not staff", async () => {
    const short = deps({ role: "guide", email: "guide@example.test" });
    const tooShort = await updateStaffAccountRecord({ ...edit, password: "123" }, short.deps);
    assert.equal(tooShort.ok, false);
    assert.deepEqual(short.calls.auth, []);

    for (const role of ["admin", "tourist"]) {
      const other = deps({ role, email: "boss@example.test" });
      const refused = await updateStaffAccountRecord(
        { ...edit, password: "new-secret" },
        other.deps,
      );
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.code, "not_staff");
      assert.deepEqual(other.calls.auth, []);
      assert.deepEqual(other.calls.saved, []);
    }
    const missing = deps(null);
    const gone = await updateStaffAccountRecord(edit, missing.deps);
    assert.equal(gone.ok, false);
  });

  it("reports an email that another account already uses and saves nothing", async () => {
    const { calls, deps: d } = deps({ role: "driver", email: "old@example.test" });
    const result = await updateStaffAccountRecord(edit, {
      ...d,
      updateAuth: async () => {
        throw new Error("A user with this email address has already been registered");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "duplicate");
    assert.deepEqual(calls.saved, []);
  });
});

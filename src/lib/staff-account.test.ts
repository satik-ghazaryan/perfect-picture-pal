import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStaffAccountRecord } from "./staff-account";

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

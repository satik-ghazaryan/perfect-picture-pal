import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mayResetOwnPassword, validNewPassword } from "./password-reset";

describe("password reset rules", () => {
  it("asks for six characters typed the same way twice", () => {
    assert.match(validNewPassword("12345", "12345"), /6 նիշ/);
    assert.match(validNewPassword("secret-1", "secret-2"), /նույնը/);
    assert.equal(validNewPassword("secret-1", "secret-1"), "");
  });

  it("leaves guide and driver passwords to the admin", () => {
    assert.equal(mayResetOwnPassword("tourist"), true);
    assert.equal(mayResetOwnPassword("admin"), true);
    assert.equal(mayResetOwnPassword(undefined), true);
    assert.equal(mayResetOwnPassword("guide"), false);
    assert.equal(mayResetOwnPassword("driver"), false);
  });
});

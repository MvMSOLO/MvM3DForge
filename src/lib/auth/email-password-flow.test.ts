import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailAndPasswordEnabled } from "./email-password.ts";
import {
  emailPasswordErrorMessage,
  hasPersistedAuthUser,
  validateEmailPasswordForm,
} from "./email-password-flow.ts";

describe("email/password account flow", () => {
  it("enables the real Better Auth email/password endpoints", () => {
    assert.equal(emailAndPasswordEnabled, true);
  });

  it("normalizes the email and trims the signup name", () => {
    assert.deepEqual(
      validateEmailPasswordForm({
        mode: "signup",
        name: "  MVM User  ",
        email: "  MVM.USER@example.com ",
        password: "a-strong-password",
      }),
      {
        ok: true,
        name: "MVM User",
        email: "mvm.user@example.com",
        password: "a-strong-password",
      },
    );
  });

  it("rejects bad email, short names, and out-of-range passwords", () => {
    assert.deepEqual(
      validateEmailPasswordForm({ mode: "signup", name: "X", email: "x@example.com", password: "12345678" }),
      { ok: false, message: "Enter your name (2–80 characters)." },
    );
    assert.deepEqual(
      validateEmailPasswordForm({ mode: "signin", name: "", email: "not-an-email", password: "12345678" }),
      { ok: false, message: "Enter a valid email address." },
    );
    assert.deepEqual(
      validateEmailPasswordForm({ mode: "signin", name: "", email: "user@example.com", password: "short" }),
      { ok: false, message: "Password must be between 8 and 128 characters." },
    );
    assert.equal(
      validateEmailPasswordForm({ mode: "signup", name: "Valid name", email: "x".repeat(250) + "@example.com", password: "a-strong-password" }).ok,
      false,
    );
  });

  it("maps duplicate accounts and invalid credentials to clear messages", () => {
    assert.equal(
      emailPasswordErrorMessage("signup", { status: 422, code: "USER_ALREADY_EXISTS", message: "User already exists" }),
      "An account with this email already exists. Sign in instead.",
    );
    assert.equal(
      emailPasswordErrorMessage("signin", { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }),
      "Email or password is incorrect.",
    );
  });

  it("uses sanitized messages for unavailable database/service errors", () => {
    assert.equal(
      emailPasswordErrorMessage("signup", { status: 503, message: "postgres://secret-user:secret-password/db failed" }),
      "Account storage is temporarily unavailable. Please try again shortly.",
    );
    assert.equal(
      emailPasswordErrorMessage("signup", { status: 503, code: "AUTH_DATABASE_NOT_CONFIGURED" }),
      "Account storage isn't connected yet. Please try again later.",
    );
    assert.equal(
      emailPasswordErrorMessage("signup", { status: 500, message: "relation public.user missing; password=secret" }),
      "The authentication service is temporarily unavailable. Please try again shortly.",
    );
  });

  it("does not treat empty/error-shaped responses as a successful account", () => {
    assert.equal(hasPersistedAuthUser(null), false);
    assert.equal(hasPersistedAuthUser({ error: "Database failed" }), false);
    assert.equal(hasPersistedAuthUser({ user: { id: "" } }), false);
    assert.equal(hasPersistedAuthUser({ user: { id: "user_123" } }), true);
  });
});

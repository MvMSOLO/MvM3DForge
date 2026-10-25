export type EmailPasswordMode = "signin" | "signup";

export type EmailPasswordForm = {
  mode: EmailPasswordMode;
  name: string;
  email: string;
  password: string;
};

export type AuthErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

export type FormValidationResult =
  | { ok: true; name: string; email: string; password: string }
  | { ok: false; message: string };

/** Validate and normalize inputs before a request reaches Better Auth. */
export function validateEmailPasswordForm(input: EmailPasswordForm): FormValidationResult {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (input.mode === "signup" && (name.length < 2 || name.length > 80)) {
    return { ok: false, message: "Enter your name (2–80 characters)." };
  }
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, message: "Password must be between 8 and 128 characters." };
  }

  return { ok: true, name, email, password };
}

/**
 * Convert Better Auth/server failures to stable user-safe messages.
 * Never display arbitrary server exception text or SQL/driver details.
 */
export function emailPasswordErrorMessage(
  mode: EmailPasswordMode,
  error: AuthErrorLike | unknown,
): string {
  const fallback =
    mode === "signup"
      ? "We couldn't create your account. Please try again."
      : "We couldn't sign you in. Check your email and password.";

  if (!error || typeof error !== "object") return fallback;
  const details = error as AuthErrorLike;
  const code = typeof details.code === "string" ? details.code.toUpperCase() : "";
  const status = typeof details.status === "number" ? details.status : 0;
  const message = typeof details.message === "string" ? details.message.trim() : "";
  const normalizedMessage = message.toLowerCase();

  if (
    code === "AUTH_DATABASE_NOT_CONFIGURED" ||
    code === "DATABASE_UNAVAILABLE" ||
    code === "DATABASE_SCHEMA_NOT_READY"
  ) {
    return code === "AUTH_DATABASE_NOT_CONFIGURED"
      ? "Account storage isn't connected yet. Please try again later."
      : "Account storage is temporarily unavailable. Please try again shortly.";
  }
  if (status === 503) {
    return "Account storage is temporarily unavailable. Please try again shortly.";
  }
  if (
    code.includes("USER_ALREADY_EXISTS") ||
    normalizedMessage.includes("user already exists") ||
    normalizedMessage.includes("email already exists")
  ) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (
    code.includes("INVALID_EMAIL") ||
    normalizedMessage.includes("invalid email")
  ) {
    return "Enter a valid email address.";
  }
  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    normalizedMessage.includes("invalid email or password") ||
    normalizedMessage.includes("invalid credentials") ||
    normalizedMessage.includes("incorrect password")
  ) {
    return "Email or password is incorrect.";
  }
  if (status >= 500) {
    return "The authentication service is temporarily unavailable. Please try again shortly.";
  }

  return fallback;
}

/** A response counts as successful only when Better Auth returns a real user. */
export function hasPersistedAuthUser(
  data: unknown,
): data is { user: { id: string } } {
  if (!data || typeof data !== "object" || !("user" in data)) return false;
  const user = data.user;
  return Boolean(
    user &&
      typeof user === "object" &&
      "id" in user &&
      typeof user.id === "string" &&
      user.id.length > 0,
  );
}

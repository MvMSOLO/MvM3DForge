export type AuthDatabaseReadiness =
  | { ok: true }
  | { ok: false; code: "AUTH_DATABASE_NOT_CONFIGURED"; message: string };

/**
 * A serverless production instance must use persistent account storage.
 * PGLite is suitable for local/preview work, but its process-local state is
 * not durable across independent production instances.
 */
export function resolveAuthDatabaseReadiness(input: {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
}): AuthDatabaseReadiness {
  if (input.nodeEnv !== "production" || input.databaseUrl?.trim()) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "AUTH_DATABASE_NOT_CONFIGURED",
    message:
      "Account storage is not connected on this deployment yet. " +
      "A persistent database must be connected before accounts can be created or used.",
  };
}

/** Central brand + version point. Rename the product here. */
export const brand = {
  name: "MVM 3D Forge",
  short: "MVM",
  version: "1.0.0",
  apiVersion: "1.0.0",
  schemaVersion: 1 as const,
  tagline: "Code-first 3D studio",
  /** Units are metres. World is right-handed, Y-up, matching glTF. */
  units: "metres",
  up: "Y",
  handedness: "right",
  runtimeLanguage: "javascript" as const,
  lastVerified: "2026-10-22",
};

export const API_VERSION = brand.apiVersion;
export const SCHEMA_VERSION = brand.schemaVersion;

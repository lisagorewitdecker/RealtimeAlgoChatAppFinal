export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface ProfileEmailIdentity {
  primaryEmailAddressId: string | null;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts a stable snapshot from either Clerk's SDK user shape or its
 * snake_case webhook payload. A missing primary address is represented
 * explicitly so address removal and verification changes can be detected.
 */
export function getProfileEmailIdentity(value: unknown): ProfileEmailIdentity {
  const user = getRecord(value);
  const primaryEmailAddressId =
    getString(user?.["primaryEmailAddressId"]) ??
    getString(user?.["primary_email_address_id"]);
  const addresses =
    (Array.isArray(user?.["emailAddresses"]) && user["emailAddresses"]) ||
    (Array.isArray(user?.["email_addresses"]) && user["email_addresses"]) ||
    [];
  const primaryAddress = addresses
    .map(getRecord)
    .find(
      (address) =>
        address?.["id"] === primaryEmailAddressId && primaryEmailAddressId,
    );
  const rawEmail =
    getString(primaryAddress?.["emailAddress"]) ??
    getString(primaryAddress?.["email_address"]);
  const normalizedEmail = rawEmail ? normalizeEmail(rawEmail) : null;
  const email =
    normalizedEmail && isValidEmail(normalizedEmail) ? normalizedEmail : null;
  const verification = getRecord(primaryAddress?.["verification"]);

  return {
    primaryEmailAddressId,
    primaryEmail: email,
    primaryEmailVerified: verification?.["status"] === "verified",
  };
}

export function isSameProfileEmailIdentity(
  left: ProfileEmailIdentity,
  right: ProfileEmailIdentity,
): boolean {
  return (
    left.primaryEmailAddressId === right.primaryEmailAddressId &&
    left.primaryEmail === right.primaryEmail &&
    left.primaryEmailVerified === right.primaryEmailVerified
  );
}

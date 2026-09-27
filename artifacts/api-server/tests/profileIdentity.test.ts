import assert from "node:assert/strict";
import test from "node:test";
import {
  getProfileEmailIdentity,
  isSameProfileEmailIdentity,
  isValidEmail,
  normalizeEmail,
} from "../src/lib/profileIdentity.ts";

test("normalizes email addresses before saving them", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
});

test("rejects malformed profile email addresses", () => {
  assert.equal(isValidEmail("person@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
});

test("reads the primary address and verification from Clerk webhook fields", () => {
  assert.deepEqual(
    getProfileEmailIdentity({
      primary_email_address_id: "email-primary",
      email_addresses: [
        {
          id: "email-primary",
          email_address: "  Person@Example.COM ",
          verification: { status: "verified" },
        },
        {
          id: "email-secondary",
          email_address: "other@example.com",
          verification: { status: "verified" },
        },
      ],
    }),
    {
      primaryEmailAddressId: "email-primary",
      primaryEmail: "person@example.com",
      primaryEmailVerified: true,
    },
  );
});

test("represents a removed primary address as an unverified empty identity", () => {
  assert.deepEqual(
    getProfileEmailIdentity({
      primary_email_address_id: null,
      email_addresses: [],
    }),
    {
      primaryEmailAddressId: null,
      primaryEmail: null,
      primaryEmailVerified: false,
    },
  );
});

test("detects a primary email verification change", () => {
  assert.equal(
    isSameProfileEmailIdentity(
      {
        primaryEmailAddressId: "email-primary",
        primaryEmail: "person@example.com",
        primaryEmailVerified: false,
      },
      {
        primaryEmailAddressId: "email-primary",
        primaryEmail: "person@example.com",
        primaryEmailVerified: true,
      },
    ),
    false,
  );
});

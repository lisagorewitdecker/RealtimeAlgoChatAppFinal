import { expect, test, type Locator } from "@playwright/test";
import {
  AUTH_LAYOUT_SUITE,
  browserTestWaiver,
} from "@workspace/browser-test-requirements";

// A run missing E2E_CHAT_URL has already been stopped by the config's
// globalSetup, before this file was loaded. The one way past it is the
// deliberate waiver, declared here at file scope so every case below is
// marked skipped as it is collected, rather than failing on a page that was
// never going to load.
const waiver = browserTestWaiver(AUTH_LAYOUT_SUITE);
test.skip(waiver.waived, waiver.reason);

test.use({
  baseURL: process.env["E2E_CHAT_URL"],
  viewport: { width: 375, height: 720 },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "devstudio_accessibility_prefs",
      JSON.stringify({
        highContrast: false,
        fontScale: 1.4,
        reduceMotion: false,
      }),
    );
  });
});

async function expectReadableWithinViewport(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();

  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const textNode = Array.from(element.querySelectorAll("*")).find(
      (child) => child.children.length === 0 && child.textContent?.trim(),
    );
    const style = window.getComputedStyle(textNode ?? element);
    let scrollContainer = element.parentElement;
    while (scrollContainer) {
      const overflowY = window.getComputedStyle(scrollContainer).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollContainer = scrollContainer.parentElement;
    }
    const scrollRect = scrollContainer?.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      fontSize: Number.parseFloat(style.fontSize),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollTop: scrollRect?.top ?? 0,
      scrollBottom: scrollRect?.bottom ?? window.innerHeight,
    };
  });

  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(376);
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.scrollTop - 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.scrollBottom + 1);
  expect(bounds.fontSize).toBeGreaterThanOrEqual(18);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
}

async function expectPageFitsViewport(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  }));

  expect(dimensions.documentHeight).toBeLessThanOrEqual(
    dimensions.viewportHeight + 2,
  );
}

test("sign-in controls remain readable and reachable at 1.4x text", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expectReadableWithinViewport(
    page.getByText("Sign in to your DevStudioApp Workspace", { exact: true }),
  );
  await expectReadableWithinViewport(
    page.getByText("Sign in to your DevStudioApp workspace.", { exact: true }),
  );
  await expectReadableWithinViewport(page.getByPlaceholder("Email address"));
  await expectReadableWithinViewport(page.getByPlaceholder("Password"));
  await expectReadableWithinViewport(page.getByRole("button", { name: "Sign in" }));
  await expectReadableWithinViewport(page.getByRole("button", { name: "Forgot password" }));
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Continue with Google" }),
  );
  await expectReadableWithinViewport(page.getByRole("button", { name: "Continue with X" }));
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Continue with Apple" }),
  );
  await expectReadableWithinViewport(
    page.getByText("New here? Create an account", { exact: true }),
  );
  await expectPageFitsViewport(page);
});

test("sign-up controls remain readable and reachable at 1.4x text", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await expectReadableWithinViewport(
    page.getByText("Create your account", { exact: true }),
  );
  await expectReadableWithinViewport(
    page.getByText("Join DevStudioApp to chat, call, and build together.", {
      exact: true,
    }),
  );
  await expectReadableWithinViewport(page.getByPlaceholder("Email address"));
  await expectReadableWithinViewport(page.getByPlaceholder("Password"));
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Create account" }),
  );
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Continue with Google" }),
  );
  await expectReadableWithinViewport(page.getByRole("button", { name: "Continue with X" }));
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Continue with Apple" }),
  );
  await expectReadableWithinViewport(
    page.getByText("Already have an account? Sign in", { exact: true }),
  );
  await expectPageFitsViewport(page);
});

test("email verification remains readable and reachable at 1.4x text", async ({
  page,
}) => {
  await page.goto("/sign-up?authVisualState=email-verification");
  await expectReadableWithinViewport(
    page.getByText("Verify your email", { exact: true }),
  );
  await expectReadableWithinViewport(
    page.getByText("Enter the code sent to your email address.", { exact: true }),
  );
  await expectReadableWithinViewport(
    page.getByPlaceholder("Email verification code"),
  );
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Verify email" }),
  );
  await expectReadableWithinViewport(
    page.getByText("Already have an account? Sign in", { exact: true }),
  );
  await expectPageFitsViewport(page);
});

test("sign-in email verification remains readable and reachable at 1.4x text", async ({
  page,
}) => {
  await page.goto("/sign-in?authVisualState=client-trust-verification");
  await expectReadableWithinViewport(
    page.getByText("Verify your account", { exact: true }),
  );
  await expectReadableWithinViewport(
    page.getByText("Enter the code sent to your email.", { exact: true }),
  );
  await expectReadableWithinViewport(page.getByPlaceholder("6-digit code"));
  await expectReadableWithinViewport(page.getByRole("button", { name: "Verify" }));
  await expectReadableWithinViewport(
    page.getByRole("button", { name: "Back to sign in" }),
  );
  await expectPageFitsViewport(page);
});
import { expect, test, type Page } from "./fixtures";
import type { BrowserContext, CDPSession } from "@playwright/test";

// Slice 14 done-when, automated: phone and laptop show the same list. Chromium's virtual authenticator stands in for
// the phone's passkey store; the credential made on device A is copied into device B's authenticator, as a synced
// passkey (or a phone scanned from the laptop) would be. Natalie still checks it on real devices.
test.use({ online: true });

async function authenticator(context: BrowserContext, page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, id: authenticatorId };
}

const settings = async (page: Page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
};
const settled = (page: Page) =>
  page.waitForFunction(() => {
    const m = JSON.parse(localStorage.getItem("ember.sync") ?? "{}");
    return m.uploaded && m.outbox?.length === 0;
  });

test("a passkey made on one device signs another into the same list", async ({ page: a, context, browser }) => {
  const authA = await authenticator(context, a);
  await a.goto("/");
  await a.getByRole("button", { name: "What's on your mind?" }).click();
  await a.getByRole("textbox", { name: "Capture a thought" }).fill("Made on the laptop");
  await a.keyboard.press("Enter");
  await a.getByRole("button", { name: "Close" }).click();
  await settled(a);

  await settings(a);
  await a.getByRole("button", { name: "Use Ember on another device" }).click();
  await expect(a.getByRole("main").getByText(/On your other device, open Ember/)).toBeVisible();
  const { credentials } = await authA.cdp.send("WebAuthn.getCredentials", { authenticatorId: authA.id });
  expect(credentials).toHaveLength(1);

  // Device B: its own storage and no cookie, with the same passkey available.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  const authB = await authenticator(ctxB, b);
  await authB.cdp.send("WebAuthn.addCredential", { authenticatorId: authB.id, credential: credentials[0] });
  await b.goto("/");
  await b.getByRole("button", { name: "Already use Ember? Sign in" }).click(); // a fresh device opens on the first run
  await b.getByRole("button", { name: "Sign in with a passkey" }).click();
  await b.getByRole("button", { name: "Open menu" }).click();
  await b.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(b.getByRole("region", { name: "Needs sorting" })).toContainText("Made on the laptop");
  expect((await ctxB.cookies()).find((c) => c.name === "ember_uid")?.value).toBe((await context.cookies()).find((c) => c.name === "ember_uid")?.value);
  await ctxB.close();
});

test("a failed sign-in says so plainly, and the device keeps its own list", async ({ page, context }) => {
  await authenticator(context, page); // empty: no passkey to offer
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByText("That didn't sign you in. Try again, or keep using Ember on this device.").or(page.getByText("Ember can nudge you"))).toBeVisible();
});

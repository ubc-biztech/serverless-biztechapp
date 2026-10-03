import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Exercise the real service and templates without creating an SES client or
// sending mail. Unexpected infrastructure access fails instead of going live.
const serviceClass = build({
  entryPoints: [fileURLToPath(new URL("../EmailService/SESEmailService.js", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["@aws-sdk/client-ses", "nodemailer", "ics"],
}).then((bundle) => {
  const context = vm.createContext({
    module: { exports: {} },
    require(name) {
      if (["@aws-sdk/client-ses", "nodemailer", "ics"].includes(name)) return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: {
      log() {},
      error(error) { throw error; }
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return context.module.exports.default;
});

async function renderEmail(ename, registrationStatus, emailType, isApplicationBased = true) {
  const SESEmailService = await serviceClass;
  const messages = [];
  const service = Object.create(SESEmailService.prototype);
  service.transporter = { async sendMail(message) { messages.push(message); } };
  await service.sendDynamicQR(
    {
      id: "event-id",
      year: 2026,
      ename,
      isApplicationBased
    },
    {
      id: "applicant@example.com",
      fname: "Applicant"
    },
    registrationStatus,
    emailType
  );
  assert.equal(messages.length, 1);
  return messages[0];
}

for (const ename of ["Product+", "HelloHacks 2026"]) {
  for (const emailType of [undefined, "application"]) {
    for (const status of ["waitlist", "acceptedPending"]) {
      test(`${ename}: ${status} uses the same event in ${emailType || "registration"} subject and body`, async () => {
        const message = await renderEmail(ename, status, emailType);
        const label = emailType === "application" ? "Application" : "Registration";
        assert.equal(message.subject, `BizTech ${ename} Event ${label} Status`);
        assert.equal(message.to, "applicant@example.com");
        assert.ok(message.html.includes("Hello Applicant,"));
        if (status === "acceptedPending") {
          assert.ok(message.html.includes(`You've been accepted to ${ename}!`));
          assert.ok(message.html.includes("href=\"https://app.ubcbiztech.com/events\""));
          assert.ok(!message.html.includes("will be reviewing it shortly"));
        } else {
          assert.ok(message.html.includes(`Thank you for registering for ${ename}!`));
          assert.ok(message.html.includes("will be reviewing it shortly"));
          assert.ok(!message.html.includes("Confirm your attendance"));
        }
        if (ename === "Product+") assert.ok(!message.html.includes("HelloHacks"));
      });
    }
  }
}

test("registered status keeps the registration confirmation template", async () => {
  const { html } = await renderEmail("Product+", "registered");
  assert.ok(html.includes("You have been registered for UBC BizTech's <b>Product+</b> event."));
  assert.ok(!html.includes("will be reviewing it shortly"));
});

test("non-application event keeps its generic status template", async () => {
  const { html } = await renderEmail("Tech & Business Night", "waitlist", undefined, false);
  assert.ok(html.includes("Your registration status for UBC BizTech's Tech & Business Night event is: <b>waitlist</b>"));
  assert.ok(!html.includes("will be reviewing it shortly"));
});

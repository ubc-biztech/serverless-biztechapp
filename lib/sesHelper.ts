import { SES } from "@aws-sdk/client-ses";

const ses = new SES({
  // BUG (pre-existing, preserved): these env vars are not validated, so the SES
  // client is constructed with `undefined` credentials when they are unset. The
  // casts keep that behaviour rather than introducing a runtime check.
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
  region: "us-west-2",
});

/**
 * Narrower than `EmailMessage` in lib/types.ts, whose `to: string | string[]`
 * does not match this function's `ToAddresses: [to]` usage.
 */
interface OutgoingEmail {
  to: string;
  html: string;
  subject: string;
}

/**
 * emails should be an array of objects with address and html
 * 
 * emails: [
 *   {
 *     to: "email@example.com",
 *     html: "<html>...</html>",
 *     subject: "Subject"
 *   }
 * ]
 */
export async function sendEmails(emails: OutgoingEmail[]): Promise<void> {
  const SOURCE_EMAIL = "ubcbiztech@gmail.com"; // can change if needed

  // SES rate limiting, based on 2024 BP script
  const BATCH_SIZE = 3;
  const DELAY_BETWEEN_BATCHES_MS = 1000;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async ({ to, html, subject }) => {
        const emailData = {
          Destination: {
            ToAddresses: [to],
          },
          Message: {
            Subject: { Data: subject },
            Body: {
              Html: { Data: html },
            },
          },
          Source: SOURCE_EMAIL,
        };

        await ses.sendEmail(emailData);
      })
    );

    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
  }
}

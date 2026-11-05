// Triggered by SQS (queue: ticket-emails). Each message = one new registration:
//   { "eventId": "...", "userId": "..." }
//
// For each message:
//   1. Read the registration and the event from DynamoDB
//   2. Skip if the user cancelled, or if the email was already sent (idempotency)
//   3. Generate a QR code PNG and save it to S3 (tickets/<ticketId>.png)
//   4. Send the ticket email with SES
//   5. Mark the registration as emailed
//
// Uses "partial batch response": only failed messages go back to the queue.
// Enable "Report batch item failures" on the SQS trigger for this to work.
import QRCode from "qrcode";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { ddb, TABLE } from "./utils.mjs";

const s3 = new S3Client({});
const ses = new SESv2Client({});
const BUCKET = process.env.SITE_BUCKET;
const SITE_URL = process.env.SITE_URL; // https://event.subhe.site
const FROM_EMAIL = process.env.FROM_EMAIL; // tickets@subhe.site

// Never put user data into HTML without escaping it
const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function formatDate(iso) {
  return new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function buildEmail({ name, event, qrUrl, ticketCode }) {
  const subject = `تذكرتك: ${event.title}`;
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;background:#f5f6fa;padding:24px;margin:0">
  <div dir="rtl" style="direction:rtl;max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:24px;text-align:center">
    <h2 style="color:#1e3a8a;margin-top:0">مرحباً ${escapeHtml(name)} 👋</h2>
    <p>تم تأكيد تسجيلك في:</p>
    <h3 style="margin:8px 0">${escapeHtml(event.title)}</h3>
    <p>📅 ${escapeHtml(formatDate(event.date))}<br>📍 ${escapeHtml(event.location)}</p>
    <img src="${qrUrl}" alt="QR code" width="220" height="220" style="margin:16px auto;display:block">
    <p style="font-family:monospace;font-size:18px;letter-spacing:2px;direction:ltr">${ticketCode}</p>
    <p style="color:#6b7280">اعرض هذا الرمز عند الدخول.</p>
    <a href="${SITE_URL}/tickets.html" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">عرض تذاكري</a>
  </div>
</body></html>`;
  const text = `مرحباً ${name}\n\nتم تأكيد تسجيلك في: ${event.title}\nالموعد: ${formatDate(event.date)}\nالمكان: ${event.location}\nرقم التذكرة: ${ticketCode}\n\nتذاكرك: ${SITE_URL}/tickets.html`;
  return { subject, html, text };
}

async function processMessage(record) {
  const { eventId, userId } = JSON.parse(record.body);
  const regKey = { PK: `EVENT#${eventId}`, SK: `REG#${userId}` };

  const [{ Item: reg }, { Item: event }] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: regKey, ConsistentRead: true })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVENT#${eventId}`, SK: "META" } })),
  ]);

  if (!reg || !event) {
    console.log("Skip: registration or event no longer exists", { eventId, userId });
    return;
  }
  if (reg.emailSentAt) {
    console.log("Skip: email already sent (duplicate message)", { ticketId: reg.ticketId });
    return;
  }
  if (!reg.email) {
    console.log("Skip: registration has no email", { ticketId: reg.ticketId });
    return;
  }

  // QR content: enough for the check-in page (phase 3) to find and verify the ticket
  const qrContent = `${eventId}|${userId}|${reg.ticketId}`;
  const png = await QRCode.toBuffer(qrContent, { width: 440, margin: 2 });
  const qrKey = `tickets/${reg.ticketId}.png`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: qrKey, Body: png, ContentType: "image/png" }));

  const ticketCode = reg.ticketId.slice(0, 8).toUpperCase();
  const { subject, html, text } = buildEmail({
    name: reg.name || reg.email,
    event,
    qrUrl: `${SITE_URL}/${qrKey}`,
    ticketCode,
  });

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: `فعالياتي <${FROM_EMAIL}>`,
      Destination: { ToAddresses: [reg.email] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } },
        },
      },
    })
  );

  // Mark as sent. If the user cancelled in the meantime, the condition fails and we just log it.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: regKey,
        UpdateExpression: "SET qrKey = :q, emailSentAt = :t",
        ConditionExpression: "attribute_exists(SK)",
        ExpressionAttributeValues: { ":q": qrKey, ":t": new Date().toISOString() },
      })
    );
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    console.log("Registration was cancelled after the email was sent", { ticketId: reg.ticketId });
  }

  console.log("Ticket sent", { ticketId: reg.ticketId, to: reg.email });
}

export const handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      await processMessage(record);
    } catch (err) {
      console.error("Failed message", record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

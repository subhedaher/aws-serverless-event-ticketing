// Invoked by EventBridge Scheduler 24 hours before an event, with input: { "eventId": "..." }
//
// One Query on PK = EVENT#<id> returns the event (SK = META) AND all its registrations (SK = REG#...),
// because we stored them in the same partition. Then one reminder email per registration.
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { ddb, TABLE } from "./utils.mjs";

const ses = new SESv2Client({});
const SITE_URL = process.env.SITE_URL;
const FROM_EMAIL = process.env.FROM_EMAIL;
// SES sandbox allows 1 email/second. Raise this after getting production access.
const SEND_RATE = Number(process.env.SEND_RATE_PER_SEC || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const formatDate = (iso) =>
  new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

async function loadEventWithRegistrations(eventId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `EVENT#${eventId}` },
        ExclusiveStartKey,
      })
    );
    items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return {
    event: items.find((i) => i.SK === "META"),
    registrations: items.filter((i) => i.SK.startsWith("REG#")),
  };
}

// Claim the reminder first, so a duplicate scheduler run never emails the same person twice.
async function claimReminder(reg) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: reg.PK, SK: reg.SK },
        UpdateExpression: "SET reminderSentAt = :t",
        ConditionExpression: "attribute_exists(SK) AND attribute_not_exists(reminderSentAt)",
        ExpressionAttributeValues: { ":t": new Date().toISOString() },
      })
    );
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

function buildEmail(reg, event) {
  const qrImg = reg.qrKey
    ? `<img src="${SITE_URL}/${reg.qrKey}" alt="QR code" width="200" height="200" style="margin:16px auto;display:block">`
    : "";
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;background:#f5f6fa;padding:24px;margin:0">
  <div dir="rtl" style="direction:rtl;max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:24px;text-align:center">
    <h2 style="color:#1e3a8a;margin-top:0">⏰ تذكير: فعاليتك بكرة!</h2>
    <p>مرحباً ${escapeHtml(reg.name || "")}، نذكّرك بموعد:</p>
    <h3 style="margin:8px 0">${escapeHtml(event.title)}</h3>
    <p>📅 ${escapeHtml(formatDate(event.date))}<br>📍 ${escapeHtml(event.location)}</p>
    ${qrImg}
    <p style="color:#6b7280">لا تنسَ إحضار تذكرتك.</p>
    <a href="${SITE_URL}/tickets.html" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">عرض تذاكري</a>
  </div>
</body></html>`;
  const text = `تذكير: ${event.title}\nالموعد: ${formatDate(event.date)}\nالمكان: ${event.location}\n\nتذاكرك: ${SITE_URL}/tickets.html`;
  return { subject: `⏰ تذكير: ${event.title} بكرة`, html, text };
}

export const handler = async (input) => {
  const { eventId } = input;
  const { event, registrations } = await loadEventWithRegistrations(eventId);

  if (!event) {
    console.log("Event not found, nothing to do", { eventId });
    return { sent: 0 };
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const reg of registrations) {
    if (!reg.email || !(await claimReminder(reg))) {
      skipped++;
      continue;
    }
    try {
      const { subject, html, text } = buildEmail(reg, event);
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
      sent++;
    } catch (err) {
      failed++;
      console.error("Reminder failed", { ticketId: reg.ticketId, to: reg.email }, err);
    }
    await sleep(1000 / SEND_RATE); // stay under the SES sending rate
  }

  console.log("Reminders done", { eventId, sent, skipped, failed });
  return { sent, skipped, failed };
};

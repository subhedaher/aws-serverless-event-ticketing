// GET /me/tickets  (logged-in user)
//
// Step 1: Query GSI1 for GSI1PK = "USER#<userId>"  -> all registrations of this user
// Step 2: BatchGet the events (PK = EVENT#id, SK = META) -> titles, dates, images
// Two cheap key-based reads, no Scan.
import { QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, getUser, withErrors } from "./utils.mjs";

async function getRegistrations(userId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `USER#${userId}` },
        ExclusiveStartKey,
      })
    );
    items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// BatchGet accepts max 100 keys per call and may return some keys as "unprocessed".
async function getEvents(eventIds) {
  const events = {};
  for (let i = 0; i < eventIds.length; i += 100) {
    let keys = eventIds.slice(i, i + 100).map((id) => ({ PK: `EVENT#${id}`, SK: "META" }));
    for (let attempt = 0; keys.length && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: keys } } }));
      for (const item of res.Responses?.[TABLE] ?? []) events[item.eventId] = item;
      keys = res.UnprocessedKeys?.[TABLE]?.Keys ?? [];
      if (keys.length) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt)); // back off
    }
  }
  return events;
}

export const handler = withErrors(async (event) => {
  const user = getUser(event);
  if (!user) return json(401, { message: "Please log in first" });

  const registrations = await getRegistrations(user.userId);
  if (registrations.length === 0) return json(200, { tickets: [] });

  const eventIds = [...new Set(registrations.map((r) => r.eventId))];
  const events = await getEvents(eventIds);

  const tickets = registrations
    .map((r) => {
      const ev = events[r.eventId];
      return {
        ticketId: r.ticketId,
        eventId: r.eventId,
        status: r.status,
        checkedIn: r.checkedIn,
        qrKey: r.qrKey ?? null, // set by sendTicket after the QR is generated
        registeredAt: r.createdAt,
        event: ev
          ? { title: ev.title, date: ev.date, location: ev.location, imageKey: ev.imageKey ?? null }
          : null, // event was deleted
      };
    })
    // soonest event first, deleted events last
    .sort((a, b) => (a.event?.date ?? "9999").localeCompare(b.event?.date ?? "9999"));

  return json(200, { tickets });
});

// POST /checkin  (admin only)
// Body: { "eventId": "<event chosen on the check-in page>", "qr": "<eventId>|<userId>|<ticketId>" }
//
// One transaction:
//   1. Mark the registration as checked in ONLY IF it exists, the ticketId matches,
//      and it was not checked in before (a ticket works once)
//   2. Increase checkedInCount on the event (for the stats page)
// If a condition fails, DynamoDB returns the current item, so we can explain why without another read.
import { TransactWriteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ddb, TABLE, json, parseBody, getUser, isAdmin, validId, withErrors } from "./utils.mjs";

const fail = (code, message, extra = {}) => json(200, { ok: false, code, message, ...extra });

export const handler = withErrors(async (event) => {
  const admin = getUser(event);
  if (!isAdmin(admin)) return json(403, { message: "Admins only" });

  const body = parseBody(event);
  if (!body || typeof body.qr !== "string" || !validId(body.eventId)) {
    return json(400, { message: "eventId and qr are required" });
  }

  const parts = body.qr.trim().split("|");
  if (parts.length !== 3 || !validId(parts[0]) || !parts[1] || parts[1].length > 64 || !validId(parts[2])) {
    return fail("INVALID", "رمز غير صالح. هذا ليس رمز تذكرة.");
  }
  const [eventId, userId, ticketId] = parts;

  if (eventId !== body.eventId) {
    return fail("WRONG_EVENT", "هذه التذكرة لفعالية أخرى.");
  }

  const regKey = { PK: `EVENT#${eventId}`, SK: `REG#${userId}` };
  const now = new Date().toISOString();

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: regKey,
              UpdateExpression: "SET checkedIn = :true, checkedInAt = :now, checkedInBy = :admin",
              ConditionExpression: "attribute_exists(SK) AND ticketId = :tid AND checkedIn = :false",
              ExpressionAttributeValues: {
                ":true": true, ":false": false, ":now": now, ":admin": admin.userId, ":tid": ticketId,
              },
              ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: `EVENT#${eventId}`, SK: "META" },
              UpdateExpression: "SET checkedInCount = if_not_exists(checkedInCount, :zero) + :one",
              ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name !== "TransactionCanceledException") throw err;

    const reason = err.CancellationReasons?.[0];
    if (reason?.Code !== "ConditionalCheckFailed") throw err;

    // The item as it is now (empty if it does not exist)
    const current = reason.Item ? unmarshall(reason.Item) : null;
    if (!current) {
      return fail("NOT_FOUND", "التذكرة غير موجودة أو تم إلغاء التسجيل.");
    }
    if (current.ticketId !== ticketId) {
      return fail("OLD_TICKET", "تذكرة قديمة. صاحبها ألغى وسجّل من جديد، اطلب منه التذكرة الأحدث.", {
        name: current.name,
      });
    }
    if (current.checkedIn) {
      return fail("ALREADY_USED", "هذه التذكرة استُخدمت من قبل!", {
        name: current.name,
        checkedInAt: current.checkedInAt,
      });
    }
    throw err;
  }

  // Transactions do not return the item on success, so read the attendee's name for the screen
  const { Item: reg } = await ddb.send(new GetCommand({ TableName: TABLE, Key: regKey }));

  return json(200, {
    ok: true,
    code: "OK",
    message: "أهلاً وسهلاً! تم تسجيل الحضور",
    name: reg?.name ?? null,
    email: reg?.email ?? null,
    checkedInAt: now,
  });
});

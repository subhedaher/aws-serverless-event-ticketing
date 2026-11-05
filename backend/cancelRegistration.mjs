// DELETE /events/{id}/register  (logged-in user)
// Deletes the registration and frees one seat, in one transaction.
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ddb, TABLE, json, getUser, validId, withErrors } from "./utils.mjs";

export const handler = withErrors(async (event) => {
  const user = getUser(event);
  if (!user) return json(401, { message: "Please log in first" });

  const eventId = event.pathParameters?.id;
  if (!validId(eventId)) return json(400, { message: "Invalid event id" });

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: TABLE,
              Key: { PK: `EVENT#${eventId}`, SK: `REG#${user.userId}` },
              // cannot cancel after being checked in
              ConditionExpression: "attribute_exists(SK) AND checkedIn = :false",
              ExpressionAttributeValues: { ":false": false },
              // On failure, return the current item so we can tell WHY it failed
              ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: `EVENT#${eventId}`, SK: "META" },
              UpdateExpression: "SET registeredCount = registeredCount - :one",
              ConditionExpression: "registeredCount > :zero",
              ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      const reason = err.CancellationReasons?.[0];
      const current = reason?.Item ? unmarshall(reason.Item) : null;
      if (current?.checkedIn) {
        return json(409, { message: "لا يمكن إلغاء التسجيل بعد تسجيل الحضور" });
      }
      return json(404, { message: "أنت غير مسجّل في هذه الفعالية" });
    }
    throw err;
  }

  return json(200, { message: "Registration cancelled" });
});

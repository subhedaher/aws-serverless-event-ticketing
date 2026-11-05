// POST /events/{id}/register  (logged-in user)
//
// One transaction does two things together (both succeed or both fail):
//   1. Increase registeredCount ONLY IF registeredCount < capacity and the event is in the future
//   2. Create the registration ONLY IF this user is not registered yet
// This prevents overbooking and double registration, even with many requests at the same second.
//
// After the transaction succeeds, a message is sent to SQS so sendTicket can email the ticket.
import { randomUUID } from "node:crypto";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ddb, TABLE, json, getUser, validId, withErrors } from "./utils.mjs";

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;

export const handler = withErrors(async (event) => {
  const user = getUser(event);
  if (!user) return json(401, { message: "Please log in first" });

  const eventId = event.pathParameters?.id;
  if (!validId(eventId)) return json(400, { message: "Invalid event id" });

  const now = new Date().toISOString();

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: { PK: `EVENT#${eventId}`, SK: "META" },
              UpdateExpression: "SET registeredCount = registeredCount + :one",
              ConditionExpression: "attribute_exists(PK) AND registeredCount < #cap AND #d > :now",
              // "date" and "capacity" are DynamoDB reserved words, so we use placeholders
              ExpressionAttributeNames: { "#d": "date", "#cap": "capacity" },
              ExpressionAttributeValues: { ":one": 1, ":now": now },
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: {
                PK: `EVENT#${eventId}`,
                SK: `REG#${user.userId}`,
                GSI1PK: `USER#${user.userId}`, // for the "My Tickets" page later
                GSI1SK: `EVENT#${eventId}`,
                eventId,
                userId: user.userId,
                email: user.email,
                name: user.name,
                ticketId: randomUUID(),
                status: "CONFIRMED",
                checkedIn: false,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      const [eventCheck, regCheck] = err.CancellationReasons ?? [];
      if (regCheck?.Code === "ConditionalCheckFailed") {
        return json(409, { message: "أنت مسجّل بالفعل في هذه الفعالية" });
      }
      if (eventCheck?.Code === "ConditionalCheckFailed") {
        return json(409, { message: "الفعالية مكتملة أو غير متاحة" });
      }
    }
    throw err;
  }

  // The registration is already saved. If queuing the email fails, we still return success
  // and log the error (the ticket is visible on the "My Tickets" page anyway).
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ eventId, userId: user.userId }),
      })
    );
  } catch (err) {
    console.error("Could not queue ticket email", { eventId, userId: user.userId }, err);
  }

  return json(201, { message: "Registered successfully" });
});

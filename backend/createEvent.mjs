// POST /events  (admin only)
// Body: { title, date (ISO string), location, capacity }
// Also creates a one-time EventBridge schedule that runs sendReminders 24 hours before the event.
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { ddb, TABLE, json, parseBody, getUser, isAdmin, toPublicEvent, withErrors } from "./utils.mjs";

const scheduler = new SchedulerClient({});
const REMINDER_HOURS = 24;

// Creates "reminder-<eventId>" to fire 24h before the event. Skipped if that moment already passed.
async function scheduleReminder(eventId, eventDate) {
  const remindAt = new Date(new Date(eventDate).getTime() - REMINDER_HOURS * 3600 * 1000);
  if (remindAt <= new Date(Date.now() + 60 * 1000)) {
    console.log("Event is less than 24h away, no reminder scheduled", { eventId });
    return null;
  }
  // Scheduler wants "at(yyyy-mm-ddThh:mm:ss)" without milliseconds or "Z"
  const at = remindAt.toISOString().slice(0, 19);
  await scheduler.send(
    new CreateScheduleCommand({
      Name: `reminder-${eventId}`,
      ScheduleExpression: `at(${at})`,
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE", // the schedule deletes itself after it runs
      Target: {
        Arn: process.env.REMINDER_FUNCTION_ARN,
        RoleArn: process.env.SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ eventId }),
      },
    })
  );
  return at;
}

function validate(body) {
  const errors = [];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const capacity = body.capacity;
  const date = new Date(body.date);
  // Optional, plain text (shown with textContent, so HTML is never rendered)
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (title.length < 3 || title.length > 100) errors.push("title must be 3-100 characters");
  if (location.length < 2 || location.length > 100) errors.push("location must be 2-100 characters");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) errors.push("capacity must be 1-10000");
  if (isNaN(date.getTime()) || date <= new Date()) errors.push("date must be a valid future date");
  if (description.length > 2000) errors.push("description must be at most 2000 characters");

  return { errors, data: { title, location, capacity, description, date: isNaN(date) ? null : date.toISOString() } };
}

export const handler = withErrors(async (event) => {
  const user = getUser(event);
  if (!isAdmin(user)) return json(403, { message: "Admins only" });

  const body = parseBody(event);
  if (!body) return json(400, { message: "Invalid JSON body" });

  const { errors, data } = validate(body);
  if (errors.length) return json(400, { message: errors.join(", ") });

  const eventId = randomUUID();
  const item = {
    PK: `EVENT#${eventId}`,
    SK: "META",
    GSI1PK: "EVENTS", // lets listEvents query all events by date
    GSI1SK: data.date,
    eventId,
    ...data,
    registeredCount: 0,
    createdBy: user.userId,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  // The event is saved. If scheduling the reminder fails, log it but still return success.
  let reminderAt = null;
  try {
    reminderAt = await scheduleReminder(eventId, data.date);
  } catch (err) {
    console.error("Could not schedule reminder", { eventId }, err);
  }

  return json(201, { event: toPublicEvent(item), reminderAt });
});

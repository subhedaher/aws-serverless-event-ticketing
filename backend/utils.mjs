// Shared helpers for all Lambda functions.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME;
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// CORS headers are added by API Gateway (HTTP API CORS settings), not here.
export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Returns the parsed JSON body, {} when empty, or null when invalid.
export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

// Reads the user from the JWT claims that the API Gateway JWT authorizer already verified.
export function getUser(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) return null;

  // HTTP API passes groups as a string like "[admins users]"
  let groups = claims["cognito:groups"] ?? [];
  if (typeof groups === "string") {
    groups = groups.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  }
  return { userId: claims.sub, email: claims.email, name: claims.name, groups };
}

export function isAdmin(user) {
  return !!user && user.groups.includes("admins");
}

// Only allow ids that look like a UUID, so nobody can inject odd keys.
export function validId(id) {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
}

// Shape of an event as returned to the browser.
export function toPublicEvent(item) {
  return {
    eventId: item.eventId,
    title: item.title,
    description: item.description ?? "",
    date: item.date,
    location: item.location,
    capacity: item.capacity,
    registeredCount: item.registeredCount,
    seatsLeft: Math.max(0, item.capacity - item.registeredCount),
    imageKey: item.imageKey ?? null,
  };
}

// Wraps a handler so unexpected errors return 500 and are logged to CloudWatch.
export function withErrors(fn) {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      console.error(err);
      return json(500, { message: "Internal server error" });
    }
  };
}

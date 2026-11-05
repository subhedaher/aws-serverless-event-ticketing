// GET /admin/stats  (admin only)
// All events (past and upcoming) with registration and attendance numbers, newest first.
// Same GSI1 query as listEvents, but without the "only future events" filter.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, getUser, isAdmin, withErrors } from "./utils.mjs";

export const handler = withErrors(async (event) => {
  if (!isAdmin(getUser(event))) return json(403, { message: "Admins only" });

  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "EVENTS" },
        ScanIndexForward: false, // newest date first
        ExclusiveStartKey,
      })
    );
    items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const events = items.map((e) => {
    const checkedIn = e.checkedInCount ?? 0;
    return {
      eventId: e.eventId,
      title: e.title,
      date: e.date,
      location: e.location,
      capacity: e.capacity,
      registered: e.registeredCount,
      checkedIn,
      // attendance rate = who came / who registered
      attendanceRate: e.registeredCount > 0 ? Math.round((checkedIn / e.registeredCount) * 100) : 0,
    };
  });

  return json(200, { events });
});

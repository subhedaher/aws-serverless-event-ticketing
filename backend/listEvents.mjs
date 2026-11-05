// GET /events  (public)
// Lists upcoming events using GSI1 (no Scan). Event items have GSI1PK = "EVENTS", GSI1SK = date.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, toPublicEvent, withErrors } from "./utils.mjs";

export const handler = withErrors(async () => {
  const now = new Date().toISOString();
  const items = [];
  let ExclusiveStartKey;

  // Query returns max 1 MB per call, so keep reading pages.
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk AND GSI1SK >= :now",
        ExpressionAttributeValues: { ":pk": "EVENTS", ":now": now },
        ExclusiveStartKey,
      })
    );
    items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return json(200, { events: items.map(toPublicEvent) });
});

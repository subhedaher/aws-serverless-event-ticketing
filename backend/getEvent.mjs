// GET /events/{id}  (public)
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, toPublicEvent, validId, withErrors } from "./utils.mjs";

export const handler = withErrors(async (event) => {
  const eventId = event.pathParameters?.id;
  if (!validId(eventId)) return json(400, { message: "Invalid event id" });

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `EVENT#${eventId}`, SK: "META" },
    })
  );

  if (!res.Item) return json(404, { message: "Event not found" });
  return json(200, { event: toPublicEvent(res.Item) });
});

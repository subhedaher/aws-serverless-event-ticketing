// POST /events/{id}/upload-url  (admin only)
// Body: { contentType: "image/jpeg" | "image/png" | "image/webp" }
// Returns a presigned URL so the browser uploads the image straight to S3 (valid for 5 minutes).
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, parseBody, getUser, isAdmin, validId, withErrors } from "./utils.mjs";

// Newer SDK versions add a checksum of an EMPTY body to presigned URLs by default,
// which makes real uploads fail. Only add checksums when S3 requires them.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
const BUCKET = process.env.IMAGES_BUCKET;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const handler = withErrors(async (event) => {
  const user = getUser(event);
  if (!isAdmin(user)) return json(403, { message: "Admins only" });

  const eventId = event.pathParameters?.id;
  if (!validId(eventId)) return json(400, { message: "Invalid event id" });

  const body = parseBody(event);
  const ext = body && TYPES[body.contentType];
  if (!ext) return json(400, { message: "contentType must be image/jpeg, image/png or image/webp" });

  const imageKey = `images/${eventId}-${randomUUID()}.${ext}`;

  // Save the image key on the event (fails if the event does not exist).
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `EVENT#${eventId}`, SK: "META" },
        UpdateExpression: "SET imageKey = :k",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: { ":k": imageKey },
      })
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return json(404, { message: "Event not found" });
    throw err;
  }

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: imageKey, ContentType: body.contentType }),
    // Sign the Content-Type too, so the URL only accepts the image type we allowed
    { expiresIn: 300, signableHeaders: new Set(["content-type"]) }
  );

  return json(200, { uploadUrl, imageKey });
});

# 🎟️ Event Ticketing System — Serverless on AWS

A full event registration and ticketing platform built entirely on AWS serverless services and deployed with **Terraform**.
Users sign up, register for events, receive a QR code ticket by email, get a reminder 24 hours before the event, and are checked in at the door by scanning their QR code.

![Architecture](docs/architecture.png)

## 📸 Screenshots

| Upcoming events | My tickets |
| --- | --- |
| ![Events](docs/screenshots/events.png) | ![My tickets](docs/screenshots/my-tickets.png) |

| Ticket email (QR code) | Reminder email |
| --- | --- |
| ![Ticket email](docs/screenshots/ticket-email.png) | ![Reminder email](docs/screenshots/reminder-email.png) |

| Check-in on a phone | Admin stats |
| --- | --- |
| <img src="docs/screenshots/check-in.png" width="320"> | ![Stats](docs/screenshots/stats.png) |

---

## ✨ Features

**Attendees**
- Sign up and log in (email verification)
- Browse upcoming events with live seat availability
- Event details page with a shareable link (copy, WhatsApp, add to Google Calendar)
- Register and cancel with one click
- Receive a ticket email with a QR code
- Receive a reminder email 24 hours before the event
- "My Tickets" page with QR codes and attendance status

**Admins**
- Create events with an image
- Scan tickets with the phone camera to check people in
- Stats per event: registered, checked in, attendance rate

**Operations**
- Email alerts when a ticket email fails, a Lambda function errors, or the API returns `5xx`
- The whole stack is deployed with one `terraform apply`

---

## 🧱 AWS Services

| Service | Used for |
| --- | --- |
| **Amazon S3** | Private bucket for the website, event images, and QR codes |
| **Amazon CloudFront** | HTTPS delivery of the site with Origin Access Control (OAC) |
| **Amazon API Gateway** (HTTP API) | 9 routes, JWT authorizer, throttling |
| **Amazon Cognito** | Sign-up, login, email verification, `admins` group |
| **AWS Lambda** (Node.js 22, arm64) | 11 functions, each with its own least-privilege IAM role |
| **Amazon DynamoDB** | Single-table design with one Global Secondary Index |
| **Amazon SQS** | Queue for ticket emails, with a dead-letter queue |
| **Amazon EventBridge Scheduler** | One-time reminder schedule per event |
| **Amazon SES** | Transactional email from `tickets@subhe.site` (DKIM) |
| **Amazon CloudWatch + SNS** | Logs, alarms, and email alerts |

---

## 🔄 How a registration works

```mermaid
sequenceDiagram
    actor U as User
    participant API as API Gateway
    participant R as registerEvent
    participant DB as DynamoDB
    participant Q as SQS
    participant T as sendTicket
    participant S3 as S3
    participant SES as SES

    U->>API: POST /events/{id}/register (JWT)
    API->>API: Verify JWT (Cognito)
    API->>R: Invoke
    R->>DB: Transaction: seat count +1 (if seats left) and create registration (if new)
    R->>Q: Send message {eventId, userId}
    R-->>U: 201 Registered (instant)
    Q->>T: Batch of messages
    T->>DB: Read registration (skip if already emailed)
    T->>S3: Save QR code PNG
    T->>SES: Send ticket email
    T->>DB: Mark as emailed
```

---

## 🧠 Key Design Decisions

### 1. Single-table DynamoDB design
Events and registrations live in one table. An event and all its registrations share the same partition key, so one `Query` returns everything about an event.

| Item | PK | SK | GSI1PK | GSI1SK |
| --- | --- | --- | --- | --- |
| Event | `EVENT#<id>` | `META` | `EVENTS` | `<date>` |
| Registration | `EVENT#<id>` | `REG#<userId>` | `USER#<userId>` | `EVENT#<id>` |

`GSI1` is **overloaded** to answer two different questions:
- `GSI1PK = EVENTS` → all events sorted by date (home page, admin stats)
- `GSI1PK = USER#<id>` → all tickets of one user ("My Tickets")

**No `Scan` anywhere in the code.**

### 2. No overbooking, no double registration
`registerEvent` uses a **DynamoDB transaction** with two conditions:
1. Increase `registeredCount` **only if** it is below `capacity`
2. Create the registration **only if** it does not exist yet

Both succeed or both fail, so even 100 requests in the same second cannot exceed the seat limit (no race condition).

### 3. Tickets that work only once
`checkIn` uses a transaction that marks the ticket as used **only if** the ticket ID matches and it was not used before. It also uses `ReturnValuesOnConditionCheckFailure` to explain *why* a scan failed (already used, old ticket, cancelled) without an extra read.

### 4. Decoupled emails with SQS
Registration returns immediately; the ticket email is sent in the background.
- **Dead-letter queue** after 3 failed attempts, with a CloudWatch alarm
- **Idempotent worker:** a duplicate message never sends a second email
- **Partial batch responses:** only failed messages are retried

### 5. Direct image uploads with presigned URLs
Admins upload images straight from the browser to S3 using a 5-minute presigned URL. The `Content-Type` is part of the signature, so only images can be uploaded, only to `images/`.

### 6. Scheduled reminders without polling
When an event is created, `createEvent` creates a **one-time EventBridge schedule** 24 hours before the event. The schedule deletes itself after it runs (`ActionAfterCompletion: DELETE`). No cron job running all day.

### 7. Security
- **Private S3 bucket**, readable only by this CloudFront distribution (OAC + `AWS:SourceArn` condition)
- **JWT authorizer** rejects invalid tokens before any Lambda runs; admin routes also check the `admins` group inside the function
- **One IAM role per function** with only the actions and resources it needs (for example, `listEvents` can only `Query` the GSI, not the table)
- `iam:PassRole` limited to one role and one service (prevents privilege escalation)
- **API throttling** (burst 50, rate 100 requests/second) stops floods before they reach Lambda
- CORS limited to the site's domain
- All user input validated in Lambda; user data escaped in HTML and emails

---

## 🏗️ Infrastructure as Code (Terraform)

Every AWS resource is defined in Terraform and split into small modules. `envs/dev` calls the modules and passes the outputs of one module into the inputs of another.

| Module | Creates |
| --- | --- |
| `data` | DynamoDB table + `GSI1`, point-in-time recovery |
| `auth` | Cognito user pool, web app client (no secret), `admins` group |
| `site` | Private S3 bucket, CloudFront distribution, OAC, bucket policy, CORS for presigned uploads |
| `messaging` | SQS queue + dead-letter queue (redrive after 3 failures) |
| `email` | SES domain identity with DKIM |
| `scheduler` | IAM role that EventBridge Scheduler uses to invoke `sendReminders` |
| `lambda` | One function + its own IAM role, log group (14-day retention) |
| `api` | HTTP API, JWT authorizer, integrations, routes, stage, Lambda permissions |
| `monitoring` | SNS topic + alarms (DLQ not empty, Lambda errors, API `5xx`) |

**Highlights**
- **One map, eleven functions:** all functions and their permissions are listed once in `lambdas.tf`; `for_each` creates the role, policy, log group, and function for each one.
- **Least privilege in code:** each function gets only the IAM statements listed for it, built with a `dynamic` block.
- **No hand-copied values:** the API URL and Cognito client ID are written into `config.js` by `templatefile`, so the site always points at the right resources.
- **One shared package:** the `backend/` folder is zipped once and used by all functions; a code change updates them through `source_code_hash`.
- **Remote state:** stored in S3 with versioning and native S3 locking (`use_lockfile`).

### Why three different alarms

| What fails | Lambda errors | API 5xx | DLQ |
| --- | --- | --- | --- |
| A function crashes on start (e.g. missing package) | ✅ | | ✅ |
| `sendTicket` fails to send an email | ❌ handled, returns `batchItemFailures` | | ✅ |
| An API function hits an unexpected error | ❌ caught by `withErrors`, returns 500 | ✅ | |

Each alarm covers a gap the others miss.

---

## 🚀 Deploy

**Prerequisites**
- Terraform `>= 1.10`, Node.js 22, AWS credentials
- An S3 bucket for Terraform state (created once by hand, versioning enabled), set in `infra/envs/dev/versions.tf`
- A domain you control, for sending email with SES

**Steps**

```bash
cd backend && npm ci && cd ..

cd infra/envs/dev
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

**After the first apply**
1. Add the three DKIM records from `terraform output dkim_records` to your DNS (CNAME).
2. Confirm the SNS subscription email to receive alerts.
3. Sign up on the site, then add your user to the `admins` group in Cognito and log in again.

**Note:** reminder schedules are created at runtime by `createEvent`, so `terraform destroy` does not remove them. Delete any leftover `reminder-*` schedules in EventBridge Scheduler.

---

## 🔌 API

| Method | Path | Access | Function |
| --- | --- | --- | --- |
| GET | `/events` | Public | `listEvents` |
| GET | `/events/{id}` | Public | `getEvent` |
| POST | `/events` | Admin | `createEvent` |
| POST | `/events/{id}/upload-url` | Admin | `getUploadUrl` |
| POST | `/events/{id}/register` | User | `registerEvent` |
| DELETE | `/events/{id}/register` | User | `cancelRegistration` |
| GET | `/me/tickets` | User | `getMyTickets` |
| POST | `/checkin` | Admin | `checkIn` |
| GET | `/admin/stats` | Admin | `getStats` |

Background functions: `sendTicket` (SQS trigger), `sendReminders` (EventBridge Scheduler).

---

## 📁 Project Structure

```
backend/                 Lambda functions (Node.js, AWS SDK v3)
  utils.mjs              shared helpers (auth claims, responses, errors)
  *.mjs                  one file per function
frontend/                static site (HTML + vanilla JavaScript)
  index.html             events
  login.html             sign-up / login / confirm
  tickets.html           my tickets with QR codes
  admin.html             create events + stats
  checkin.html           camera QR scanner
  js/config.js           API URL, region, Cognito client ID (generated by Terraform)
infra/                   Terraform
  modules/               one folder per part of the system
  envs/dev/              the dev environment: calls the modules and wires them together
  templates/             config.js template
docs/                    architecture diagram, screenshots
```

---

## 🐛 Problems I Solved

### Application

| Problem | Cause | Fix |
| --- | --- | --- |
| `ValidationException: reserved keyword: capacity` | `capacity` and `date` are DynamoDB reserved words | Expression attribute names (`#cap`, `#d`) |
| Image uploads would fail | Newer AWS SDK adds a checksum of an empty body to presigned URLs | `requestChecksumCalculation: "WHEN_REQUIRED"` |
| Any file type could be uploaded | `Content-Type` was not signed | `signableHeaders: ["content-type"]` |
| `401 Unauthorized` with a valid login | Wrong Cognito client ID in the authorizer audience | Decoded the JWT and compared `aud` / `iss` |
| Registered event not shown right away | GSI reads are eventually consistent | Short delay before reloading |
| Broken Arabic text layout in Gmail | Gmail strips `dir` from `<html>` | Set `dir="rtl"` on the email container |
| Cancel button returned "not registered" after check-in | One transaction condition covered two different failures | `ReturnValuesOnConditionCheckFailure: ALL_OLD` to return the right message |
| A Lambda-errors alarm would miss failed ticket emails | The worker handles errors and returns `batchItemFailures`, so Lambda counts the run as successful | A separate alarm on the dead-letter queue |

### Terraform

| Problem | Cause | Fix |
| --- | --- | --- |
| Ticket emails stopped; messages landed in the DLQ | `node_modules` was missing from the Lambda zip, so `qrcode` could not load | `npm ci` before packaging, then **DLQ redrive** sent the failed messages again, no data lost |
| `AlreadyExistsException` for the SES identity | The identity was created by hand before Terraform | `import` block to bring it under Terraform without recreating it |
| Dependency cycle between S3 and CloudFront | Bucket CORS and policy need the distribution, and the distribution needs the bucket | Separate `aws_s3_bucket_cors_configuration` and `aws_s3_bucket_policy` resources |
| Login failed after deploy | App client allowed SRP, but the site uses `USER_PASSWORD_AUTH` | Read the frontend code and enabled only the flows it uses |
| Deprecation warning on the GSI | `hash_key` / `range_key` inside a GSI are deprecated | `key_schema` blocks |
| Log groups with no retention | Lambda creates its own log group on first run | Log group in Terraform with 14-day retention, and `depends_on` so it exists first |

---

## 💰 Cost

Everything is serverless and pay-per-use. With low traffic the monthly cost is a few cents (S3 storage, SES at $0.16 per 1,000 emails). Lambda, API Gateway, SQS, Scheduler, and Cognito stay within their free tiers.

---

## 🚀 Roadmap

- [x] Infrastructure as Code with Terraform (one-command deploy)
- [x] API Gateway `5xx` alarm
- [x] SES production access (send to any email address)
- [ ] CI/CD with GitHub Actions (OIDC, `plan` on pull requests, `apply` on `main`)
- [ ] Custom domains with Route 53 and ACM
- [ ] A `prod` environment using the same modules
- [ ] Unit tests for the Lambda functions

---

## 👤 Author

**Subhe Daher** — built while learning AWS serverless architecture and Terraform.

# ---------- Package the whole backend folder into one zip ----------
data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend"
  output_path = "${path.module}/build/backend.zip"
}

# ---------- Functions and their permissions ----------
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region

  table_arn  = module.data.table_arn
  gsi1_arn   = "${module.data.table_arn}/index/GSI1"
  bucket_arn = module.site.bucket_arn
  queue_arn  = module.messaging.queue_arn

  from_email       = "tickets@subhe.site"
  ses_identity_arn = "arn:aws:ses:${local.region}:${local.account_id}:identity/*"
  schedule_arn     = "arn:aws:scheduler:${local.region}:${local.account_id}:schedule/default/reminder-*"

  lambda_env = {
    TABLE_NAME = module.data.table_name
  }

  functions = {
    # ---------- Public ----------
    listEvents = {
      statements = [
        { actions = ["dynamodb:Query"], resources = [local.gsi1_arn] },
      ]
    }

    getEvent = {
      statements = [
        { actions = ["dynamodb:GetItem"], resources = [local.table_arn] },
      ]
    }

    # ---------- User ----------
    registerEvent = {
      env = { QUEUE_URL = module.messaging.queue_url }
      statements = [
        { actions = ["dynamodb:UpdateItem", "dynamodb:PutItem"], resources = [local.table_arn] },
        { actions = ["sqs:SendMessage"], resources = [local.queue_arn] },
      ]
    }

    cancelRegistration = {
      statements = [
        { actions = ["dynamodb:DeleteItem", "dynamodb:UpdateItem"], resources = [local.table_arn] },
      ]
    }

    getMyTickets = {
      statements = [
        { actions = ["dynamodb:Query"], resources = [local.gsi1_arn] },
        { actions = ["dynamodb:BatchGetItem"], resources = [local.table_arn] },
      ]
    }

    # ---------- Admin ----------
    createEvent = {
      env = {
        REMINDER_FUNCTION_ARN = module.scheduler.reminder_function_arn
        SCHEDULER_ROLE_ARN    = module.scheduler.role_arn
      }
      statements = [
        { actions = ["dynamodb:PutItem"], resources = [local.table_arn] },
        { actions = ["scheduler:CreateSchedule"], resources = [local.schedule_arn] },
        {
          actions   = ["iam:PassRole"]
          resources = [module.scheduler.role_arn]
          conditions = [{
            test     = "StringEquals"
            variable = "iam:PassedToService"
            values   = ["scheduler.amazonaws.com"]
          }]
        },
      ]
    }

    getUploadUrl = {
      env = { IMAGES_BUCKET = module.site.bucket_name }
      statements = [
        { actions = ["dynamodb:UpdateItem"], resources = [local.table_arn] },
        { actions = ["s3:PutObject"], resources = ["${local.bucket_arn}/images/*"] },
      ]
    }

    checkIn = {
      statements = [
        { actions = ["dynamodb:UpdateItem", "dynamodb:GetItem"], resources = [local.table_arn] },
      ]
    }

    getStats = {
      statements = [
        { actions = ["dynamodb:Query"], resources = [local.gsi1_arn] },
      ]
    }

    # ---------- Background ----------
    sendTicket = {
      timeout = 30
      env = {
        SITE_BUCKET = module.site.bucket_name
        SITE_URL    = module.site.site_url
        FROM_EMAIL  = local.from_email
      }
      statements = [
        { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [local.table_arn] },
        { actions = ["s3:PutObject"], resources = ["${local.bucket_arn}/tickets/*"] },
        { actions = ["ses:SendEmail"], resources = [local.ses_identity_arn] },
        {
          actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
          resources = [local.queue_arn]
        },
      ]
    }

    sendReminders = {
      timeout = 900 # sends 1 email/second in the SES sandbox
      env = {
        SITE_URL          = module.site.site_url
        FROM_EMAIL        = local.from_email
        SEND_RATE_PER_SEC = "1"
      }
      statements = [
        { actions = ["dynamodb:Query", "dynamodb:UpdateItem"], resources = [local.table_arn] },
        { actions = ["ses:SendEmail"], resources = [local.ses_identity_arn] },
      ]
    }
  }
}

module "lambda" {
  for_each = local.functions
  source   = "../../modules/lambda"

  function_name = "${local.name_prefix}-${each.key}"
  handler       = "${each.key}.handler"
  package_path  = data.archive_file.backend.output_path
  package_hash  = data.archive_file.backend.output_base64sha256

  environment = merge(local.lambda_env, try(each.value.env, {}))
  statements  = each.value.statements
  timeout     = try(each.value.timeout, 10)
  memory_size = try(each.value.memory_size, 256)
}

# ---------- SQS -> sendTicket ----------
resource "aws_lambda_event_source_mapping" "send_ticket" {
  event_source_arn        = module.messaging.queue_arn
  function_name           = module.lambda["sendTicket"].function_name
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2 # don't flood SES (sandbox = 1 email/second)
  }
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # The function does not exist yet, so we build its ARN from its name
  reminder_function_arn = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.reminder_function_name}"
}

# Who can assume this role: only EventBridge Scheduler, only from my account
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

# What it can do: invoke sendReminders, nothing else
data "aws_iam_policy_document" "invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [local.reminder_function_arn]
  }
}

resource "aws_iam_role_policy" "invoke" {
  name   = "invoke-reminder"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.invoke.json
}
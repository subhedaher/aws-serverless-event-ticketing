locals {
  name_prefix = "${var.project}-${var.environment}" # evt-dev
}

module "data" {
  source      = "../../modules/data"
  name_prefix =  local.name_prefix 
}

module "auth" {
  source      = "../../modules/auth"
  name_prefix = local.name_prefix
}

module "site" {
  source      = "../../modules/site"
  name_prefix = local.name_prefix
}

module "messaging" {
  source      = "../../modules/messaging"
  name_prefix = local.name_prefix
}

# import {
#   to = module.email.aws_sesv2_email_identity.domain
#   id = "subhe.site"
# }

module "email" {
  source          = "../../modules/email"
  domain          = "subhe.site"
  test_recipients = ["subhedaher@gmail.com"]
}

module "scheduler" {
  source                 = "../../modules/scheduler"
  name_prefix            = local.name_prefix
  reminder_function_name = "${local.name_prefix}-sendReminders"
}
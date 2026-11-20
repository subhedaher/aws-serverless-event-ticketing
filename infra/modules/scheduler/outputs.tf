output "role_arn" {
  value = aws_iam_role.scheduler.arn
}

output "reminder_function_arn" {
  value = local.reminder_function_arn
}
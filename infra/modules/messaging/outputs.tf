output "queue_url" {
  value = aws_sqs_queue.tickets.url
}

output "queue_arn" {
  value = aws_sqs_queue.tickets.arn
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name   # for the CloudWatch alarm later
}
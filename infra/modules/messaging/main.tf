# Dead-letter queue: messages that failed 3 times end up here
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-ticket-emails-dlq"
  message_retention_seconds = 1209600   # 14 days (the maximum)
}

# Main queue
resource "aws_sqs_queue" "tickets" {
  name                       = "${var.name_prefix}-ticket-emails"
  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Only our main queue may use this DLQ
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.tickets.arn]
  })
}
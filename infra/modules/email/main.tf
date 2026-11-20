# Verify the whole domain -> any address @subhe.site can send
resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain
}

# Sandbox only: each recipient must be verified (AWS sends them a link)
resource "aws_sesv2_email_identity" "recipients" {
  for_each       = toset(var.test_recipients)
  email_identity = each.value
}
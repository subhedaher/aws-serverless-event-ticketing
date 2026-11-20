output "identity_arn" {
  value = aws_sesv2_email_identity.domain.arn
}

# The 3 records to add manually in Namecheap
output "dkim_records" {
  value = [
    for token in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      host  = "${token}._domainkey"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}
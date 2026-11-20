variable "domain" {
  type = string
}

variable "test_recipients" {
  type        = list(string)
  default     = []
  description = "SES sandbox can only send to verified addresses"
}
variable "name_prefix" {
  type = string
}

variable "max_receive_count" {
  type        = number
  default     = 3
  description = "Failed attempts before a message goes to the DLQ"
}

variable "visibility_timeout_seconds" {
  type        = number
  default     = 180
  description = "Must be >= the sendTicket Lambda timeout (AWS recommends 6x)"
}
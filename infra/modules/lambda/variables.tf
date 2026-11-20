variable "function_name" { type = string }
variable "handler"       { type = string }
variable "package_path"  { type = string }
variable "package_hash"  { type = string }

variable "environment" {
  type    = map(string)
  default = {}
}

variable "timeout" {
  type    = number
  default = 10
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# IAM permissions specific to this function
variable "statements" {
  type = list(object({
    actions   = list(string)
    resources = list(string)
    conditions = optional(list(object({
      test     = string
      variable = string
      values   = list(string)
    })), [])
  }))
  default = []
}
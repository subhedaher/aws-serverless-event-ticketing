variable "name_prefix" {
  type = string
}

variable "cors_origin" {
  type        = string
  description = "The only website allowed to call the API"
}

variable "jwt_issuer" {
  type = string
}

variable "jwt_audience" {
  type = list(string)
}

# All Lambda functions: key = short name (listEvents, ...)
variable "functions" {
  type = map(object({
    name       = string
    invoke_arn = string
  }))
}

# key = "METHOD /path"
variable "routes" {
  type = map(object({
    lambda = string
    auth   = bool
  }))
}
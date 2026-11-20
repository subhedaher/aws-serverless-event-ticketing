module "api" {
  source      = "../../modules/api"
  name_prefix = local.name_prefix

  cors_origin  = module.site.site_url
  jwt_issuer   = module.auth.issuer
  jwt_audience = [module.auth.client_id]

  functions = {
    for key, fn in module.lambda : key => {
      name       = fn.function_name
      invoke_arn = fn.invoke_arn
    }
  }

  routes = {
    "GET /events"                  = { lambda = "listEvents", auth = false }
    "GET /events/{id}"             = { lambda = "getEvent", auth = false }
    "POST /events"                 = { lambda = "createEvent", auth = true }
    "POST /events/{id}/upload-url" = { lambda = "getUploadUrl", auth = true }
    "POST /events/{id}/register"   = { lambda = "registerEvent", auth = true }
    "DELETE /events/{id}/register" = { lambda = "cancelRegistration", auth = true }
    "GET /me/tickets"              = { lambda = "getMyTickets", auth = true }
    "POST /checkin"                = { lambda = "checkIn", auth = true }
    "GET /admin/stats"             = { lambda = "getStats", auth = true }
  }
}

output "api_url" {
  value = module.api.api_url
}
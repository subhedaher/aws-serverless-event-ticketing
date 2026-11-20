module "monitoring" {
  source      = "../../modules/monitoring"
  name_prefix = local.name_prefix

  alert_email    = "subhedaher@gmail.com"
  dlq_name       = module.messaging.dlq_name
  function_names = [for fn in module.lambda : fn.function_name]
  api_id         = module.api.api_id
}
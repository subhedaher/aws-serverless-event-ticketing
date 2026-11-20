output "table_name" {
  value = module.data.table_name
}

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_client_id" {
  value = module.auth.client_id
}

output "site_url" {
  value = module.site.site_url
}

output "dkim_records" {
  value = module.email.dkim_records
}
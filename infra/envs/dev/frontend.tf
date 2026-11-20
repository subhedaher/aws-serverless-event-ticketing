locals {
  frontend_dir = "${path.module}/../../../frontend"

  mime_types = {
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".txt"  = "text/plain; charset=utf-8"
  }

  # All files except config.js (Terraform generates that one)
  frontend_files = setsubtract(fileset(local.frontend_dir, "**"), ["js/config.js"])
}

# ---------- Upload every file ----------
resource "aws_s3_object" "frontend" {
  for_each = local.frontend_files

  bucket = module.site.bucket_name
  key    = each.value
  source = "${local.frontend_dir}/${each.value}"
  etag   = filemd5("${local.frontend_dir}/${each.value}")

  content_type = lookup(
    local.mime_types,
    try(regex("\\.[^.]+$", each.value), ""),
    "application/octet-stream"
  )
}

# ---------- Generated config.js ----------
resource "aws_s3_object" "config" {
  bucket       = module.site.bucket_name
  key          = "js/config.js"
  content_type = "application/javascript; charset=utf-8"

  content = templatefile("${path.module}/../../templates/config.js.tftpl", {
    api_url   = module.api.api_url
    region    = local.region
    client_id = module.auth.client_id
  })
}
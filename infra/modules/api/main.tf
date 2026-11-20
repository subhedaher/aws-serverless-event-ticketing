locals {
  # Only the functions used by routes (not sendTicket / sendReminders)
  api_functions = toset([for r in values(var.routes) : r.lambda])
}

# ---------- The API ----------
resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.cors_origin]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

# ---------- JWT authorizer (Cognito) ----------
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

# ---------- One integration per function ----------
resource "aws_apigatewayv2_integration" "this" {
  for_each = local.api_functions

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.functions[each.key].invoke_arn
  payload_format_version = "2.0"
}

# ---------- Routes ----------
resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.this[each.value.lambda].id}"

  authorization_type = each.value.auth ? "JWT" : "NONE"
  authorizer_id      = each.value.auth ? aws_apigatewayv2_authorizer.cognito.id : null
}

# ---------- Stage ----------
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 100
  }
}

# ---------- Allow API Gateway to invoke each function ----------
resource "aws_lambda_permission" "api" {
  for_each = local.api_functions

  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.functions[each.key].name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  # The Python backend must implement these routes using HTTP API payload v2.
  routes = toset([
    "GET /me",
    "PUT /me",
    "POST /me/notifications",
    # Query parameters support browsing/filtering current and completed requests.
    "GET /requests",
    "GET /repair-history",
    "POST /requests",
    "GET /requests/{request_id}",
    "POST /requests/{request_id}/claim",
    "DELETE /requests/{request_id}/claim",
    "GET /requests/{request_id}/notes",
    "POST /requests/{request_id}/notes",
    "PATCH /requests/{request_id}/status",
    "POST /requests/{request_id}/confirmation",
    "GET /requests/{request_id}/history",
    # Lambda returns presigned URLs; file bytes travel directly to/from S3.
    "POST /requests/{request_id}/uploads",
    "GET /requests/{request_id}/files/{file_id}",
    "POST /requests/{request_id}/extractions",
    "POST /requests/{request_id}/summaries",
    # Fetch results (or poll pending extraction jobs), then review/correct them.
    "GET /requests/{request_id}/ai-results/{result_id}",
    "PATCH /requests/{request_id}/ai-results/{result_id}"
  ])
}

resource "aws_apigatewayv2_api" "backend" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"

  # API Gateway handles browser preflight requests without invoking Lambda.
  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.backend.id
  name             = "${var.name_prefix}-cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.cognito_issuer_url
    audience = [var.cognito_client_id]
  }
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = var.lambda_invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "backend" {
  for_each = local.routes

  api_id             = aws_apigatewayv2_api.backend.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.backend.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id

  # Cognito SRP access tokens carry this scope; ID tokens do not.
  # It is not an application admin role. Lambda must enforce ownership and
  # requester/volunteer permissions using the authenticated user's sub.
  authorization_scopes = ["aws.cognito.signin.user.admin"]
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${var.name_prefix}-api"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  depends_on = [aws_apigatewayv2_route.backend, aws_lambda_permission.api]
}

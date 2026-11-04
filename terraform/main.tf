terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Use the AWS credential chain (for example, AWS_PROFILE or temporary credentials).
# Do not put access keys in this configuration.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    })
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

module "frontend" {
  source = "./modules/frontend"

  name_prefix = local.name_prefix
}

module "uploads" {
  source = "./modules/uploads"

  name_prefix     = local.name_prefix
  allowed_origins = [module.frontend.website_url]
}

module "database" {
  source = "./modules/database"

  name_prefix = local.name_prefix
}

module "auth" {
  source = "./modules/auth"

  name_prefix = local.name_prefix
}

module "notifications" {
  source = "./modules/notifications"

  name_prefix = local.name_prefix
}

module "lambda_function" {
  source = "./modules/lambda_function"

  name_prefix             = local.name_prefix
  zip_path                = var.lambda_zip_path
  handler                 = var.lambda_handler
  table_arns              = values(module.database.table_arns)
  request_index_arns      = module.database.request_index_arns
  uploads_bucket_arn      = module.uploads.bucket_arn
  notifications_topic_arn = module.notifications.topic_arn
  bedrock_model_arn       = var.bedrock_model_arn

  environment_variables = {
    USERS_TABLE_NAME        = module.database.table_names.users
    REQUESTS_TABLE_NAME     = module.database.table_names.requests
    RECORDS_TABLE_NAME      = module.database.table_names.records
    STATUS_INDEX_NAME       = module.database.request_index_names.status
    REQUESTER_INDEX_NAME    = module.database.request_index_names.requester
    VOLUNTEER_INDEX_NAME    = module.database.request_index_names.volunteer
    UPLOADS_BUCKET_NAME     = module.uploads.bucket_name
    NOTIFICATIONS_TOPIC_ARN = module.notifications.topic_arn
    COGNITO_USER_POOL_ID    = module.auth.user_pool_id
    COGNITO_CLIENT_ID       = module.auth.client_id
    COGNITO_ISSUER_URL      = module.auth.issuer_url
  }
}

module "textract_lambda" {
  source = "./modules/textract_lambda"
}

module "api" {
  source = "./modules/api"

  name_prefix          = local.name_prefix
  lambda_function_name = module.lambda_function.function_name
  lambda_invoke_arn    = module.lambda_function.invoke_arn
  cognito_issuer_url   = module.auth.issuer_url
  cognito_client_id    = module.auth.client_id
  allowed_origins      = [module.frontend.website_url]
}


output "frontend_bucket_name" {
  description = "S3 bucket to receive the frontend build files."
  value       = module.frontend.bucket_name
}

output "frontend_website_url" {
  description = "URL of the frontend after its files are uploaded."
  value       = local.frontend_website_url
}

output "uploads_bucket_name" {
  description = "Private S3 bucket for uploaded photos and documents."
  value       = module.uploads.bucket_name
}

output "database_table_names" {
  description = "DynamoDB tables for users, repair requests, and related records."
  value       = module.database.table_names
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID for frontend authentication."
  value       = module.auth.user_pool_id
}

output "cognito_client_id" {
  description = "Public Cognito app client ID for the frontend."
  value       = module.auth.client_id
}

output "cognito_issuer_url" {
  description = "Cognito JWT issuer URL for API authentication."
  value       = module.auth.issuer_url
}

output "volunteer_demo_users" {
  description = "Synthetic Cognito account identities for the volunteer demo."
  value       = module.auth.volunteer_demo_users
}

output "notifications_topic_arn" {
  description = "SNS topic for requester repair-status notifications."
  value       = module.notifications.topic_arn
}

output "backend_function_name" {
  description = "Name of the Python backend Lambda function."
  value       = module.lambda_function.function_name
}

output "backend_log_group_name" {
  description = "CloudWatch log group for backend logs."
  value       = module.lambda_function.log_group_name
}

output "api_url" {
  description = "HTTPS base URL for the frontend to call the repair API."
  value       = module.api.api_url
}

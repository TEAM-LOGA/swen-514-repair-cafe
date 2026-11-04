variable "name_prefix" {
  description = "Resource naming prefix, such as repair-cafe-dev."
  type        = string
  nullable    = false

  validation {
    condition     = length(var.name_prefix) <= 30 && can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", var.name_prefix))
    error_message = "Use 2-30 lowercase letters, digits, or hyphens; start with a letter and end with a letter or digit."
  }
}

variable "zip_path" {
  description = "Path to an existing Python deployment ZIP, relative to the Terraform working directory or absolute. Build it before planning."
  type        = string
  nullable    = false

  validation {
    condition     = fileexists(var.zip_path) && endswith(var.zip_path, ".zip")
    error_message = "Provide an existing .zip file containing the Python handler and its dependencies."
  }
}

variable "handler" {
  description = "Python entry point in module.function format; app.lambda_handler requires app.py at the ZIP root."
  type        = string
  default     = "app.lambda_handler"
  nullable    = false
}

variable "table_arns" {
  description = "DynamoDB table ARNs the backend may read and update."
  type        = list(string)
  nullable    = false
}

variable "request_index_arns" {
  description = "DynamoDB request index ARNs the backend may query."
  type        = list(string)
  nullable    = false
}

variable "uploads_bucket_arn" {
  description = "Private uploads bucket ARN for reading objects and creating presigned upload/download URLs."
  type        = string
  nullable    = false
}

variable "admin_requests_topic_arns" {
  description = "Admin-only SNS topics for new request details."
  type        = list(string)
}

variable "notifications_topic_arn" {
  description = "SNS topic ARN for status messages and requester email enrollment."
  type        = string
  nullable    = false
}

variable "bedrock_model_arn" {
  description = "Bedrock foundation-model ARN or system inference-profile ARN, such as the US Sonnet 4.6 profile. Model access must be available in the account."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^arn:aws[a-z-]*:bedrock:[a-z0-9-]+:(:foundation-model|[0-9]{12}:inference-profile)/[a-zA-Z0-9.:-]+$", var.bedrock_model_arn))
    error_message = "Provide a Bedrock foundation-model ARN or system inference-profile ARN for the deployment Region and account."
  }
}

variable "environment_variables" {
  description = "Backend configuration such as table names, bucket name, topic ARN, and Cognito identifiers."
  type        = map(string)
  nullable    = false
}

variable "extraction_state_machine_arn" {
  description = "Step Functions state machine ARN the backend may start for file extraction."
  type        = string
  nullable    = false
}

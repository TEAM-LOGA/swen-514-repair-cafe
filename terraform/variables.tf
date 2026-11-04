variable "aws_region" {
  description = "AWS region for the Repair Cafe application."
  type        = string
  default     = "us-east-1"
  nullable    = false
}

variable "project_name" {
  description = "Short project name used in resource names and tags."
  type        = string
  default     = "repair-cafe"
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,23}[a-z0-9]$", var.project_name))
    error_message = "Use 3-25 lowercase letters, digits, or hyphens; start with a letter and end with a letter or digit."
  }
}

variable "environment" {
  description = "Short environment name used to distinguish deployments."
  type        = string
  default     = "dev"
  nullable    = false

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "Environment must be dev, test, or prod."
  }
}

variable "tags" {
  description = "Additional AWS tags. Project, Environment, and ManagedBy are set by the root configuration."
  type        = map(string)
  default     = {}
  nullable    = false
}

variable "lambda_zip_path" {
  description = "Path to the built Python backend ZIP, relative to terraform/ or absolute. The ZIP must exist before planning."
  type        = string
  nullable    = false
}

variable "lambda_handler" {
  description = "Python module.function entry point inside the backend ZIP."
  type        = string
  default     = "app.lambda_handler"
  nullable    = false
}

variable "admin_email" {
  description = "Optional approved Cognito user and recipient of all repair notifications."
  type        = string
  default     = ""
}

variable "bedrock_model_arn" {
  description = "Bedrock model or system inference-profile ARN in aws_region. Use the US Sonnet 4.6 inference profile for the deploying AWS account."
  type        = string
  nullable    = false
}

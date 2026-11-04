variable "name_prefix" {
  description = "Resource naming prefix."
  type        = string
  nullable    = false
}

variable "textract_lambda_arn" {
  description = "ARN of the Textract document-reader Lambda."
  type        = string
  nullable    = false
}

variable "backend_lambda_arn" {
  description = "ARN of the main backend Lambda (handles store_extraction actions)."
  type        = string
  nullable    = false
}

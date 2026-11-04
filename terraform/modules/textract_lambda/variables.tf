variable "uploads_bucket_arn" {
  description = "ARN of the S3 uploads bucket so the Textract Lambda can read uploaded files."
  type        = string
  nullable    = false
}

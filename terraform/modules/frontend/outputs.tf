output "bucket_name" {
  description = "Bucket name used when deploying the frontend files."
  value       = aws_s3_bucket.frontend.id
}

output "bucket_arn" {
  description = "Frontend bucket ARN for deployment permissions."
  value       = aws_s3_bucket.frontend.arn
}

output "website_url" {
  description = "HTTP URL of the S3 static website."
  value       = "http://${aws_s3_bucket_website_configuration.frontend.website_endpoint}"
}

output "https_origin" {
  description = "HTTPS origin for public frontend objects."
  value       = "https://${aws_s3_bucket.frontend.bucket_regional_domain_name}"
}

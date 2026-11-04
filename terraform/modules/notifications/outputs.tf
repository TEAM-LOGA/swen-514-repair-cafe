output "topic_arn" {
  description = "SNS topic ARN for Lambda publishing and subscription permissions."
  value       = aws_sns_topic.repair_status.arn
}

output "topic_name" {
  description = "Name of the repair-status SNS topic."
  value       = aws_sns_topic.repair_status.name
}

output "admin_requests_topic_arns" {
  value = aws_sns_topic.admin_requests[*].arn
}

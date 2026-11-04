output "function_name" {
  value = aws_lambda_function.textract.function_name
}

output "invoke_arn" {
  value = aws_lambda_function.textract.invoke_arn
}
output "function_arn" {
  description = "ARN of the Textract document-reader Lambda function."
  value       = aws_lambda_function.textract.arn
}

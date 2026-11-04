output "state_machine_arn" {
  description = "ARN of the extraction Step Functions state machine."
  value       = aws_sfn_state_machine.extraction.arn
}

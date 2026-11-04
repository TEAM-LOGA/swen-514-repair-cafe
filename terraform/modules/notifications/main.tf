terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_sns_topic" "repair_status" {
  name         = "${var.name_prefix}-repair-status"
  display_name = "Repair Cafe Status Updates"
  fifo_topic   = false
}

variable "admin_email" {
  description = "Optional email address for all repair notifications."
  type        = string
  default     = ""
}

resource "aws_sns_topic" "admin_requests" {
  count = var.admin_email == "" ? 0 : 1
  name  = "${var.name_prefix}-admin-requests"
}

resource "aws_sns_topic_subscription" "admin_requests" {
  count     = length(aws_sns_topic.admin_requests)
  topic_arn = aws_sns_topic.admin_requests[count.index].arn
  protocol  = "email"
  endpoint  = var.admin_email
}

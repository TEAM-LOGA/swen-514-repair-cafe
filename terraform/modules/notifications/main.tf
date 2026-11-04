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

resource "aws_sns_topic_subscription" "admin" {
  count     = var.admin_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.repair_status.arn
  protocol  = "email"
  endpoint  = var.admin_email
}

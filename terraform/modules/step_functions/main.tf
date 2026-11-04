terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# CloudWatch log group for Step Functions execution logs
resource "aws_cloudwatch_log_group" "extraction" {
  name              = "/aws/states/${var.name_prefix}-extraction"
  retention_in_days = 14
}

# IAM role assumed by the Step Functions state machine
resource "aws_iam_role" "extraction" {
  name = "${var.name_prefix}-extraction-sfn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Inline policy granting the state machine permission to invoke both Lambdas
# and to write execution logs to CloudWatch.
resource "aws_iam_role_policy" "extraction" {
  name = "${var.name_prefix}-extraction-sfn-access"
  role = aws_iam_role.extraction.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeLambdas"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = [
          var.textract_lambda_arn,
          "${var.textract_lambda_arn}:*",
          var.backend_lambda_arn,
          "${var.backend_lambda_arn}:*",
        ]
      },
      {
        Sid    = "WriteLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      }
    ]
  })
}

# Standard workflow:
#   1. ExtractText   – call the Textract Lambda with {bucket, key}
#   2. StoreResult   – call the backend Lambda with action=store_extraction
#   3. RecordFailure – on any error, call backend with action=store_extraction_failure
resource "aws_sfn_state_machine" "extraction" {
  name     = "${var.name_prefix}-extraction"
  role_arn = aws_iam_role.extraction.arn
  type     = "STANDARD"

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.extraction.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }

  definition = jsonencode({
    Comment = "Extract text from an uploaded repair-request file using Textract, then store the result."
    StartAt = "ExtractText"
    States = {
      # ── Step 1: Run the Textract Lambda ───────────────────────────────────
      ExtractText = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.textract_lambda_arn
          Payload = {
            "bucket.$" = "$.bucket"
            "key.$"    = "$.key"
          }
        }
        # Pluck the fields we need from the Lambda response envelope ($.Payload)
        ResultSelector = {
          "text.$"  = "$.Payload.text"
          "lines.$" = "$.Payload.lines"
        }
        # Write Textract output under $.extraction so original fields survive
        ResultPath = "$.extraction"
        Retry = [{
          ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException", "Lambda.TooManyRequestsException"]
          IntervalSeconds = 2
          MaxAttempts     = 2
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "RecordFailure"
        }]
        Next = "StoreResult"
      }

      # ── Step 2: Persist the extraction in DynamoDB via the backend Lambda ─
      StoreResult = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.backend_lambda_arn
          Payload = {
            action         = "store_extraction"
            "request_id.$" = "$.request_id"
            "file_id.$"    = "$.file_id"
            "record_key.$" = "$.record_key"
            "text.$"       = "$.extraction.text"
            "lines.$"      = "$.extraction.lines"
          }
        }
        # Discard the Lambda response; we only care about success/failure
        ResultPath = null
        Retry = [{
          ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException"]
          IntervalSeconds = 1
          MaxAttempts     = 2
          BackoffRate     = 2
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "RecordFailure"
        }]
        Next = "ExtractionSucceeded"
      }

      # ── Failure path: mark the file as failed in DynamoDB ─────────────────
      RecordFailure = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.backend_lambda_arn
          Payload = {
            action         = "store_extraction_failure"
            "request_id.$" = "$.request_id"
            "file_id.$"    = "$.file_id"
            "record_key.$" = "$.record_key"
          }
        }
        ResultPath = null
        Next       = "ExtractionFailed"
      }

      # ── Terminal states ────────────────────────────────────────────────────
      ExtractionSucceeded = {
        Type = "Succeed"
      }

      ExtractionFailed = {
        Type  = "Fail"
        Error = "ExtractionFailed"
        Cause = "Text extraction pipeline failed; see RecordFailure step."
      }
    }
  })
}

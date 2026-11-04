terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  function_name = "${var.name_prefix}-backend"

  # Cross-region inference needs permission for the profile and every model it
  # routes to. Look up the actual destination ARNs instead of hardcoding Regions.
  bedrock_resource_arns = concat(
    [var.bedrock_model_arn],
    flatten([
      for profile in data.aws_bedrock_inference_profile.selected :
      [for model in profile.models : model.model_arn]
    ])
  )
}

data "aws_bedrock_inference_profile" "selected" {
  count = strcontains(var.bedrock_model_arn, ":inference-profile/") ? 1 : 0

  inference_profile_id = var.bedrock_model_arn
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "backend" {
  name = "${var.name_prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "backend" {
  name = "${var.name_prefix}-backend-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteFunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.backend.arn}:*"
      },
      {
        Sid    = "ReadAndWriteRepairData"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:Query"
        ]
        Resource = var.table_arns
      },
      {
        Sid      = "QueryRequestIndexes"
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = var.request_index_arns
      },
      {
        Sid      = "ReadAndUploadFiles"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${var.uploads_bucket_arn}/*"
      },
      {
        Sid      = "PublishRepairStatus"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = var.notifications_topic_arn
      },
      {
        Sid      = "SubscribeRequesterEmail"
        Effect   = "Allow"
        Action   = "sns:Subscribe"
        Resource = var.notifications_topic_arn
        Condition = {
          StringEquals = {
            "sns:Protocol" = "email"
          }
        }
      },
      {
        # These Textract operations do not support resource-level IAM scoping.
        Sid    = "ExtractDocumentText"
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText",
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection"
        ]
        Resource = "*"
      },
      {
        Sid      = "GenerateHandoffSummary"
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = local.bedrock_resource_arns
      },
      {
        Sid      = "StartExtractionWorkflow"
        Effect   = "Allow"
        Action   = "states:StartExecution"
        Resource = var.extraction_state_machine_arn
      }
    ]
  })
}

resource "aws_lambda_function" "backend" {
  function_name    = local.function_name
  role             = aws_iam_role.backend.arn
  runtime          = "python3.13"
  handler          = var.handler
  architectures    = ["x86_64"]
  filename         = abspath(var.zip_path)
  source_code_hash = filebase64sha256(abspath(var.zip_path))
  memory_size      = 512
  timeout          = 29

  environment {
    variables = merge(var.environment_variables, {
      BEDROCK_MODEL_ID = var.bedrock_model_arn
    })
  }

  # The API module will grant API Gateway permission to invoke this function.
  depends_on = [aws_iam_role_policy.backend]
}

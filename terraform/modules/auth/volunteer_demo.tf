locals {
  demo_users = var.enable_volunteer_demo ? {
    requester   = "requester@example.invalid"
    volunteer-a = "volunteer-a@example.invalid"
    volunteer-b = "volunteer-b@example.invalid"
  } : {}
}

resource "aws_cognito_user" "volunteer_demo" {
  for_each = local.demo_users

  user_pool_id   = aws_cognito_user_pool.users.id
  username       = each.value
  message_action = "SUPPRESS"
  attributes = {
    email          = each.value
    email_verified = "true"
  }
}

resource "aws_cognito_user_in_group" "volunteer_demo" {
  for_each = { for role, user in aws_cognito_user.volunteer_demo : role => user if role != "requester" }

  user_pool_id = aws_cognito_user_pool.users.id
  group_name   = aws_cognito_user_group.volunteers.name
  username     = each.value.username
}

ephemeral "random_password" "volunteer_demo" {
  for_each = local.demo_users

  length      = 24
  min_lower   = 1
  min_upper   = 1
  min_numeric = 1
  min_special = 1
}

resource "aws_ssm_parameter" "volunteer_demo_password" {
  for_each = local.demo_users

  name             = "/${var.name_prefix}/volunteer-demo/${each.key}/password"
  description      = "Password for the Repair Cafe ${each.key} demo account"
  type             = "SecureString"
  tier             = "Standard"
  value_wo         = ephemeral.random_password.volunteer_demo[each.key].result
  value_wo_version = 1
}

# The Cognito provider has no write-only password field. Read the permanent
# password from Parameter Store during apply to keep it out of Terraform state.
resource "terraform_data" "volunteer_demo_password" {
  for_each = local.demo_users

  triggers_replace = {
    user_sub         = aws_cognito_user.volunteer_demo[each.key].sub
    password_version = aws_ssm_parameter.volunteer_demo_password[each.key].version
  }

  lifecycle {
    replace_triggered_by = [aws_ssm_parameter.volunteer_demo_password[each.key]]
  }

  provisioner "local-exec" {
    command = "python ../scripts/set_demo_password.py"
    environment = {
      COGNITO_POOL_ID         = aws_cognito_user_pool.users.id
      COGNITO_USERNAME        = each.value
      DEMO_PASSWORD_PARAMETER = aws_ssm_parameter.volunteer_demo_password[each.key].name
    }
  }
}

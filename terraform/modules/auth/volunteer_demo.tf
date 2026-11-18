locals {
  demo_users = var.enable_volunteer_demo ? {
    requester   = "requester@repaircafe.com"
    volunteer-a = "volunteer-a@repaircafe.com"
    volunteer-b = "volunteer-b@repaircafe.com"
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
    name           = title(replace(each.key, "-", " "))
  }
}

resource "aws_cognito_user_in_group" "volunteer_demo" {
  for_each = { for role, user in aws_cognito_user.volunteer_demo : role => user if role != "requester" }

  user_pool_id = aws_cognito_user_pool.users.id
  group_name   = aws_cognito_user_group.volunteers.name
  username     = each.value.username
}

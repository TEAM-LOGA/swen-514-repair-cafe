"""Set a Terraform-created Cognito demo user's permanent password from SSM."""

import os

from seed_cognito_users import aws_call, cognito


def main():
    parameter = aws_call("ssm", "get-parameter", {
        "Name": os.environ["DEMO_PASSWORD_PARAMETER"],
        "WithDecryption": True,
    })
    cognito("admin-set-user-password", {
        "UserPoolId": os.environ["COGNITO_POOL_ID"],
        "Username": os.environ["COGNITO_USERNAME"],
        "Password": parameter["Parameter"]["Value"],
        "Permanent": True,
    })


if __name__ == "__main__":
    main()

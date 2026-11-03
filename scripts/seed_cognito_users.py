"""Create demo accounts from the deployment environment's secret roster."""

import json
import os
import re
import subprocess
import sys
import tempfile


def roster():
    try:
        users = json.loads(os.environ.get("DEMO_COGNITO_USERS", ""))
        if not isinstance(users, dict) or not users:
            raise ValueError
        for email, password in users.items():
            if (
                email.count("@") != 1 or any(c.isspace() for c in email)
                or not all(email.split("@")) or not isinstance(password, str)
                or len(password) < 12 or not any(c.islower() for c in password)
                or not any(c.isupper() for c in password)
                or not any(c.isdigit() for c in password)
                or not any(not c.isalnum() and not c.isspace() for c in password)
            ):
                raise ValueError
        if len({email.lower() for email in users}) != len(users):
            raise ValueError
        return users
    except ValueError:
        sys.exit("Set DEMO_COGNITO_USERS to a JSON object of unique email addresses and Cognito-compliant passwords.")


def aws_call(service, operation, payload, expected_error=None):
    # Keep passwords out of command arguments and raw AWS output out of CI logs.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as request:
        json.dump(payload, request)
        request.flush()
        result = subprocess.run(
            ["aws", service, operation, "--cli-input-json",
             f"file://{request.name}", "--output", "json", "--no-cli-pager"],
            capture_output=True, text=True,
        )
    if result.returncode:
        match = re.search(r"An error occurred \(([A-Za-z0-9]+)\) when calling", result.stderr)
        code = match.group(1) if match else f"AWS CLI exit {result.returncode}"
        if code == expected_error:
            return None
        sys.exit(f"AWS {service} {operation} failed ({code}).")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def cognito(operation, payload, expected_error=None):
    return aws_call("cognito-idp", operation, payload, expected_error)


def main():
    users = roster()
    if sys.argv[1:] == ["--validate"]:
        return
    pool_id = os.environ["COGNITO_POOL_ID"]
    for email, password in users.items():
        account = {"UserPoolId": pool_id, "Username": email}
        user = cognito("admin-get-user", account, "UserNotFoundException")
        if user is None:
            cognito("admin-create-user", {
                **account,
                "UserAttributes": [{"Name": "email", "Value": email}],
                "MessageAction": "SUPPRESS",
            })
        elif user["UserStatus"] == "CONFIRMED" and user["Enabled"]:
            continue  # Never overwrite an existing confirmed user's password.
        elif user["UserStatus"] != "FORCE_CHANGE_PASSWORD" or not user["Enabled"]:
            sys.exit("A roster account already exists in an unexpected state. Review the Cognito pool.")
        cognito("admin-set-user-password", {**account, "Password": password, "Permanent": True})
    print(f"Confirmed Cognito demo accounts ready: {len(users)}.")


if __name__ == "__main__":
    main()

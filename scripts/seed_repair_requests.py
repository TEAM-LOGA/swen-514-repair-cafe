"""Seed one sample request per confirmed demo user."""

import os
from datetime import datetime, timezone

from seed_cognito_users import aws_call, cognito, roster


def main():
    users = roster()
    pool_id = os.environ["COGNITO_POOL_ID"]
    table_name = os.environ["REQUESTS_TABLE_NAME"]
    created_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    created = 0
    for email in users:
        user = cognito("admin-get-user", {"UserPoolId": pool_id, "Username": email})
        requester_id = next(
            (attribute["Value"] for attribute in user["UserAttributes"] if attribute["Name"] == "sub"),
            None,
        )
        if not requester_id or not user["Enabled"] or user["UserStatus"] != "CONFIRMED":
            raise SystemExit("A demo user is missing a confirmed Cognito identity.")

        # Stable ID and conditional write preserve any edits on later deployments.
        item = {
            "request_id": f"demo-desk-lamp-{requester_id}",
            "requester_id": requester_id,
            "item_name": "Desk lamp",
            "description": "The lamp will not turn on even with a new bulb.",
            "status": "Submitted",
            "created_at": created_at,
        }
        result = aws_call("dynamodb", "put-item", {
            "TableName": table_name,
            "Item": {name: {"S": value} for name, value in item.items()},
            "ConditionExpression": "attribute_not_exists(request_id)",
        }, "ConditionalCheckFailedException")
        if result is not None:
            created += 1

    print(f"Sample repair requests: {created} created, {len(users) - created} already present.")


if __name__ == "__main__":
    main()

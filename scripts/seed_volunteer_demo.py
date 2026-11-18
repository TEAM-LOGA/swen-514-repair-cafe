"""Confirm the Terraform demo accounts and seed their repair workflow."""

import json
import os
from datetime import datetime, timedelta, timezone

from seed_cognito_users import aws_call, cognito


DEMO_PASSWORD = "password"
DEMO_ROLES = {"requester", "volunteer-a", "volunteer-b"}
FIXTURES = (
    {
        "slug": "desk-lamp",
        "item_name": "Desk Lamp",
        "description": "The lamp will not turn on after a bulb replacement.",
        "status": "Submitted",
    },
    {
        "slug": "wobbly-chair",
        "item_name": "Wobbly Chair",
        "description": "The wooden chair rocks on level flooring.",
        "status": "Submitted",
    },
    {
        "slug": "usb-keyboard",
        "item_name": "USB Keyboard",
        "description": "Several keys stop responding while typing.",
        "status": "In Progress",
        "volunteer": "volunteer-a",
        "note": {
            "observations": "The A and S keys did not register in a typing test.",
            "diagnostic_notes": "The same keys failed when tested on a second computer.",
            "repair_steps": "Recorded the affected keys for the next work session.",
        },
    },
    {
        "slug": "portable-fan",
        "item_name": "Portable Fan",
        "description": "The desk fan rattles when it runs.",
        "status": "In Progress",
        "volunteer": "volunteer-b",
        "note": {
            "observations": "A rattle was reported at the lowest speed.",
            "diagnostic_notes": "One grille clip looked loose during a visual inspection.",
            "repair_steps": "Recorded the model and checked whether a replacement clip is available.",
        },
    },
    {
        "slug": "bicycle-bell",
        "item_name": "Bicycle Bell",
        "description": "The handlebar bell's lever moves but makes no sound.",
        "status": "Completed",
        "volunteer": "volunteer-a",
        "confirmed": True,
        "note": {
            "observations": "The striker was out of alignment with the bell.",
            "diagnostic_notes": "The lever still moved freely.",
            "repair_steps": "Realigned the striker and confirmed the bell rang on repeated presses.",
        },
    },
    {
        "slug": "backpack-zipper",
        "item_name": "Backpack Zipper",
        "description": "The main zipper separates immediately after closing.",
        "status": "Unresolved",
        "volunteer": "volunteer-b",
        "note": {
            "observations": "Several teeth were missing near the top of the zipper.",
            "diagnostic_notes": "The damaged section needs a replacement zipper.",
            "repair_steps": "Measured the zipper and recorded the size. No replacement was available.",
        },
    },
)


def confirm_accounts(pool_id, identities):
    if set(identities) != DEMO_ROLES or len({user["sub"] for user in identities.values()}) != 3:
        raise SystemExit("Terraform must provide three distinct volunteer demo identities.")

    accounts = []
    for role, identity in identities.items():
        email = f"{role}@repaircafe.com"
        if identity["email"] != email or not identity["sub"]:
            raise SystemExit(f"Unexpected Terraform identity for {role}.")
        account = {"UserPoolId": pool_id, "Username": email}
        user = cognito("admin-get-user", account)
        attributes = {entry["Name"]: entry["Value"] for entry in user["UserAttributes"]}
        if (
            attributes.get("sub") != identity["sub"]
            or attributes.get("email") != email
            or not user["Enabled"]
            or user["UserStatus"] not in {"CONFIRMED", "FORCE_CHANGE_PASSWORD"}
        ):
            raise SystemExit(f"Cognito returned an unexpected volunteer demo account for {role}.")
        accounts.append(account)

    for account in accounts:
        cognito("admin-set-user-password", {**account, "Password": DEMO_PASSWORD, "Permanent": True})
    print(f"Volunteer demo accounts ready: {len(accounts)}.")


def repair_fixture(fixture, identities, created_at):
    requester_id = identities["requester"]["sub"]
    request_id = f"volunteer-demo-{fixture['slug']}-{requester_id}"
    request = {
        "request_id": request_id,
        "requester_id": requester_id,
        "item_name": fixture["item_name"],
        "description": fixture["description"],
        "status": fixture["status"],
        "created_at": created_at.isoformat(),
    }
    if "volunteer" not in fixture:
        return request, None

    volunteer_id = identities[fixture["volunteer"]]["sub"]
    note_at = (created_at + timedelta(hours=2)).isoformat()
    status_hour = 1 if fixture["status"] == "In Progress" else 3
    updated_at = (created_at + timedelta(hours=status_hour)).isoformat()
    request.update(volunteer_id=volunteer_id, updated_at=updated_at)
    if fixture.get("confirmed"):
        request.update(
            outcome_confirmed_status=fixture["status"],
            outcome_confirmed_version=updated_at,
            outcome_confirmed_at=(created_at + timedelta(hours=4)).isoformat(),
        )

    note = {
        "request_id": request_id,
        "record_key": f"NOTE#{note_at}#volunteer-demo",
        "author_id": volunteer_id,
        "created_at": note_at,
        **fixture["note"],
    }
    return request, note


def conditional_put(table, item, key):
    return {
        "Put": {
            "TableName": table,
            "Item": {name: {"S": value} for name, value in item.items()},
            "ConditionExpression": "attribute_not_exists(#key)",
            "ExpressionAttributeNames": {"#key": key},
        }
    }


def seed_repair(request, note, tables):
    writes = [conditional_put(tables["requests"], request, "request_id")]
    if note:
        writes.append(conditional_put(tables["records"], note, "record_key"))
    result = aws_call(
        "dynamodb",
        "transact-write-items",
        {"TransactItems": writes},
        "TransactionCanceledException",
    )
    if result is not None:
        return True

    # Only treat a canceled transaction as a rerun if the repair already exists.
    existing = aws_call("dynamodb", "get-item", {
        "TableName": tables["requests"],
        "Key": {"request_id": {"S": request["request_id"]}},
        "ConsistentRead": True,
    })
    owner = existing.get("Item", {}).get("requester_id")
    if owner != {"S": request["requester_id"]}:
        raise SystemExit(f"Unable to seed the volunteer demo repair {request['item_name']}.")
    return False


def main():
    identities = json.loads(os.environ["VOLUNTEER_DEMO_USERS"])
    tables = json.loads(os.environ["DEMO_TABLE_NAMES"])
    confirm_accounts(os.environ["COGNITO_POOL_ID"], identities)

    today = datetime.now(timezone.utc).replace(microsecond=0)
    created = 0
    for days_ago, fixture in enumerate(FIXTURES, start=1):
        request, note = repair_fixture(fixture, identities, today - timedelta(days=days_ago))
        created += seed_repair(request, note, tables)
    print(f"Volunteer demo repairs: {created} created, {len(FIXTURES) - created} already present.")


if __name__ == "__main__":
    main()

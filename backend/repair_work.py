"""Repair notes, authorized by Cognito user ID."""

from datetime import datetime, timezone
from uuid import uuid4

from botocore.exceptions import ClientError
from boto3.dynamodb.types import TypeSerializer
import boto3


ACTIVE = {"Claimed", "In Progress"}
NOTE_FIELDS = ("observations", "diagnostic_notes", "repair_steps")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def notes(user_id, request_id, requests_table, records_table, body=None):
    request = requests_table.get_item(Key={"request_id": request_id}, ConsistentRead=True).get("Item")
    if not request:
        return 404, {"error": "Repair request not found."}
    if user_id not in {request.get("requester_id"), request.get("volunteer_id")}:
        return 403, {"error": "Only the requester and assigned volunteer can view repair notes."}
    if body is None:
        # Notes have their own prefix, separate from uploaded files and AI results.
        result = records_table.query(
            KeyConditionExpression="request_id = :request AND begins_with(record_key, :prefix)",
            ExpressionAttributeValues={":request": request_id, ":prefix": "NOTE#"},
            ScanIndexForward=False, ConsistentRead=True, Limit=50,
        )
        return 200, {"notes": result.get("Items", [])}
    if request.get("volunteer_id") != user_id:
        return 403, {"error": "Only the assigned volunteer can record repair work."}
    if request.get("status") not in ACTIVE:
        return 409, {"error": "Repair work can only be added to a claimed or in-progress request."}
    fields = {}
    for field in NOTE_FIELDS:
        value = body.get(field, "")
        if not isinstance(value, str) or len(value.strip()) > 2000:
            raise ValueError("Each repair work field must be text of at most 2,000 characters.")
        fields[field] = value.strip()
    if not any(fields.values()):
        raise ValueError("Enter observations, diagnostic notes, or repair steps.")
    timestamp = now()
    note = {
        "request_id": request_id,
        "record_key": f"NOTE#{timestamp}#{uuid4()}",
        "author_id": user_id,
        "created_at": timestamp,
        **fields,
    }
    serialize = TypeSerializer().serialize
    # Assignment and note creation are one transaction: a concurrent release
    # cannot let a former volunteer continue writing notes.
    try:
        boto3.client("dynamodb").transact_write_items(TransactItems=[
            {"ConditionCheck": {
                "TableName": requests_table.name,
                "Key": {"request_id": serialize(request_id)},
                "ConditionExpression": "volunteer_id = :self AND (#status = :claimed OR #status = :progress)",
                "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": {":self": serialize(user_id), ":claimed": serialize("Claimed"), ":progress": serialize("In Progress")},
            }},
            {"Put": {
                "TableName": records_table.name,
                "Item": {key: serialize(value) for key, value in note.items()},
                "ConditionExpression": "attribute_not_exists(record_key)",
            }},
        ])
    except ClientError as error:
        if error.response["Error"]["Code"] == "TransactionCanceledException":
            return 409, {"error": "The request changed. Refresh before adding repair work."}
        raise
    return 201, note

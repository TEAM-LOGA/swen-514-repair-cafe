"""Volunteer assignments and repair notes, authorized by Cognito user ID."""

import base64
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

from botocore.exceptions import ClientError
from boto3.dynamodb.types import TypeSerializer
import boto3


ACTIVE = {"Claimed", "In Progress"}
NOTE_FIELDS = ("observations", "diagnostic_notes", "repair_steps")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def list_work(user_id, view, params, table):
    if view == "available":
        index, key, value = os.environ["STATUS_INDEX_NAME"], "#status", "Submitted"
    else:
        index, key, value = os.environ["VOLUNTEER_INDEX_NAME"], "volunteer_id", user_id
    query = {
        "IndexName": index,
        "KeyConditionExpression": f"{key} = :value",
        "ExpressionAttributeValues": {":value": value},
        "ScanIndexForward": False,
        "Limit": 50,
    }
    if view == "available":
        query["ExpressionAttributeNames"] = {"#status": "status"}
        query["FilterExpression"] = "requester_id <> :self AND attribute_not_exists(volunteer_id)"
        query["ExpressionAttributeValues"][":self"] = user_id
    if params.get("cursor"):
        try:
            cursor = json.loads(base64.urlsafe_b64decode(params["cursor"]).decode())
            expected = {"request_id", "created_at", "status" if view == "available" else "volunteer_id"}
            if not isinstance(cursor, dict) or set(cursor) != expected or not all(isinstance(v, str) for v in cursor.values()):
                raise ValueError
            if cursor["status" if view == "available" else "volunteer_id"] != value:
                raise ValueError
            query["ExclusiveStartKey"] = cursor
        except (ValueError, TypeError, UnicodeError):
            raise ValueError("Invalid request page cursor.")
    result = table.query(**query)
    last = result.get("LastEvaluatedKey")
    return {"requests": result.get("Items", []), "next_cursor": (
        base64.urlsafe_b64encode(json.dumps(last).encode()).decode() if last else None
    )}


def claim_request(user_id, request_id, table, release=False):
    # Read for useful error responses; the conditional update is the actual lock.
    request = table.get_item(Key={"request_id": request_id}, ConsistentRead=True).get("Item")
    if not request:
        return 404, {"error": "Repair request not found."}
    if release:
        if request.get("volunteer_id") != user_id:
            return 403, {"error": "Only the assigned volunteer can release this request."}
        if request.get("status") not in ACTIVE:
            return 409, {"error": "Only claimed or in-progress requests can be released."}
        update = "SET #status = :submitted, updated_at = :now REMOVE volunteer_id, claimed_at"
        condition = "volunteer_id = :self AND (#status = :claimed OR #status = :progress)"
        values = {":self": user_id, ":submitted": "Submitted", ":claimed": "Claimed", ":progress": "In Progress", ":now": now()}
    else:
        if request.get("requester_id") == user_id:
            return 403, {"error": "You cannot volunteer for your own request."}
        if request.get("status") != "Submitted" or request.get("volunteer_id"):
            return 409, {"error": "This request is no longer available. Refresh the list."}
        update = "SET volunteer_id = :self, #status = :claimed, claimed_at = :now, updated_at = :now"
        condition = "attribute_exists(request_id) AND requester_id <> :self AND #status = :submitted AND attribute_not_exists(volunteer_id)"
        values = {":self": user_id, ":submitted": "Submitted", ":claimed": "Claimed", ":now": now()}
    try:
        result = table.update_item(
            Key={"request_id": request_id}, UpdateExpression=update,
            ConditionExpression=condition, ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=values, ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return 409, {"error": "The assignment changed. Refresh and try again."}
        raise
    return 200, result["Attributes"]


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

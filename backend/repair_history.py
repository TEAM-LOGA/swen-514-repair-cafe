"""Private repair history and requester acknowledgement of an outcome."""
import base64
import binascii
import json
import os
from datetime import datetime, timezone

from botocore.exceptions import ClientError

TERMINAL = {"Completed", "Unresolved"}
FIELDS = ("request_id", "item_name", "description", "status", "created_at", "updated_at")


def outcome(request):
    version = request.get("updated_at", request["created_at"])
    confirmation = None
    if (request.get("status") in TERMINAL
        and request.get("outcome_confirmed_status") == request["status"]
        and request.get("outcome_confirmed_version") == version):
        confirmation = {"status": request["status"], "confirmed_at": request["outcome_confirmed_at"]}
    return {"request": {key: request[key] for key in FIELDS if key in request},
            "outcome_version": version, "confirmation": confirmation}


def request_history(user_id, request_id, table, body=None):
    request = table.get_item(Key={"request_id": request_id}, ConsistentRead=True).get("Item")
    if not request:
        return 404, {"error": "Repair request not found."}
    if user_id not in {request.get("requester_id"), request.get("volunteer_id")}:
        return 403, {"error": "You cannot view this repair record."}
    if body is None:
        return 200, outcome(request)
    if request.get("requester_id") != user_id:
        return 403, {"error": "Only the requester can acknowledge this outcome."}
    if request.get("status") not in TERMINAL:
        return 409, {"error": "Only completed or unresolved outcomes can be acknowledged."}
    current = outcome(request)
    if body.get("status") != request["status"] or body.get("outcome_version") != current["outcome_version"]:
        return 409, {"error": "The outcome changed. Reload it before acknowledging."}
    if current["confirmation"]:
        return 200, current
    names = {"#status": "status"}
    values = {":self": user_id, ":status": request["status"], ":version": current["outcome_version"],
              ":now": datetime.now(timezone.utc).isoformat(timespec="microseconds")}
    # Version comparison prevents acknowledging a concurrently changed outcome.
    version_condition = "updated_at = :version" if "updated_at" in request else "attribute_not_exists(updated_at) AND created_at = :version"
    try:
        result = table.update_item(
            Key={"request_id": request_id},
            UpdateExpression="SET outcome_confirmed_at = :now, outcome_confirmed_status = :status, outcome_confirmed_version = :version",
            ConditionExpression=f"requester_id = :self AND #status = :status AND {version_condition}",
            ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return 409, {"error": "The outcome changed. Reload it before acknowledging."}
        raise
    return 200, outcome(result["Attributes"])


def search_history(user_id, is_volunteer, params, table):
    search = params.get("q", "").strip().casefold()
    selected = params.get("status", "all")
    if len(search) > 120 or selected not in TERMINAL | {"all"}:
        raise ValueError("Use a search up to 120 characters and Completed, Unresolved, or all.")
    field = "volunteer_id" if is_volunteer else "requester_id"
    index = os.environ["VOLUNTEER_INDEX_NAME" if is_volunteer else "REQUESTER_INDEX_NAME"]
    query = {"IndexName": index, "KeyConditionExpression": f"{field} = :self",
             "ExpressionAttributeValues": {":self": user_id}, "ScanIndexForward": False, "Limit": 50}
    if params.get("cursor"):
        try:
            if len(params["cursor"]) > 2048:
                raise ValueError
            cursor = json.loads(base64.urlsafe_b64decode(params["cursor"]))
            if (not isinstance(cursor, dict) or set(cursor) != {"request_id", "created_at", field}
                or not all(isinstance(v, str) and v for v in cursor.values()) or cursor[field] != user_id):
                raise ValueError
            query["ExclusiveStartKey"] = cursor
        except (ValueError, TypeError, binascii.Error):
            raise ValueError("Invalid history page cursor.")
    result = table.query(**query)
    # Page through the participant index rather than scanning other users' data.
    items = [outcome(request) for request in result.get("Items", [])
             if request.get("status") in TERMINAL
             and (selected == "all" or request["status"] == selected)
             and (not search or search in (request.get("item_name", "") + " " + request.get("description", "")).casefold())]
    last = result.get("LastEvaluatedKey")
    return {"repairs": items, "next_cursor": base64.urlsafe_b64encode(json.dumps(last).encode()).decode() if last else None}

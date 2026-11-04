import base64
import json
import boto3

textract = boto3.client("textract")


def lambda_handler(event, context):
    raw_body = event.get("body", event)
    body = json.loads(raw_body) if isinstance(raw_body, str) else (raw_body or {})

    # --- S3Object mode (called from Step Functions) ---
    # Input: { "bucket": "...", "key": "requests/..." }
    bucket = body.get("bucket")
    key = body.get("key")
    if bucket and key:
        tex_response = textract.detect_document_text(
            Document={"S3Object": {"Bucket": bucket, "Name": key}}
        )

    # --- Bytes mode (legacy / test invocation with base64) ---
    # Input: { "file": "<base64>" }
    elif body.get("file"):
        file_bytes = base64.b64decode(body["file"].split(",")[-1])
        tex_response = textract.detect_document_text(
            Document={"Bytes": file_bytes}
        )

    else:
        raise ValueError("Provide either {bucket, key} for S3 mode or {file} for base64 mode.")

    lines = [
        block["Text"]
        for block in tex_response.get("Blocks", [])
        if block["BlockType"] == "LINE"
    ]

    # Return top-level fields so Step Functions ResultSelector ($.Payload.text, $.Payload.lines)
    # can extract them directly without having to parse stringified JSON body.
    return {
        "statusCode": 200,
        "text": "\n".join(lines),
        "lines": lines,
    }

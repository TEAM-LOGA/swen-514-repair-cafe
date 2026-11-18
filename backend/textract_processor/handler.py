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

    line_blocks = [
        block
        for block in tex_response.get("Blocks", [])
        if block["BlockType"] == "LINE"
    ]

    lines = [block["Text"] for block in line_blocks]
    confidences = [round(float(block.get("Confidence") or 0), 2) for block in line_blocks]
    avg_confidence = (
        round(sum(confidences) / len(confidences), 2) if confidences else 0
    )

    # Return top-level fields so Step Functions ResultSelector
    # ($.Payload.text, $.Payload.lines, $.Payload.confidences, $.Payload.avg_confidence)
    # can extract them directly without having to parse stringified JSON body.
    return {
        "statusCode": 200,
        "text": "\n".join(lines),
        "lines": lines,
        "confidences": confidences,
        "avg_confidence": avg_confidence,
    }

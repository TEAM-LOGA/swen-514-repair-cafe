import base64
import json
import boto3

textract = boto3.client("textract")


def lambda_handler(event, context):
    try:
        raw_body = event.get("body", event)
        body = json.loads(raw_body) if isinstance(raw_body, str) else (raw_body or {})

        file_b64 = body.get("file")
        if not file_b64:
            return _response(400, {"error": "Missing required 'file' field in JSON body."})

        file_bytes = base64.b64decode(file_b64.split(",")[-1])

        tex_response = textract.detect_document_text(
            Document={"Bytes": file_bytes}
        )

        lines = [
            block["Text"]
            for block in tex_response.get("Blocks", [])
            if block["BlockType"] == "LINE"
        ]

        return _response(
            200,
            {
                "text": "\n".join(lines),
                "lines": lines,
            },
        )

    except Exception as e:
        return _response(500, {"error": str(e)})


def _response(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }
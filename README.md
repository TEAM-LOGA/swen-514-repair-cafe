# swen-514-repair-cafe

Repair Cafe is a course project for connecting people who need an item repaired with volunteer fixers. The repository contains AWS infrastructure managed with Terraform, a Python Lambda backend, and a small static website.

## Current status

- Terraform provisions the AWS resources, including API Gateway, Lambda, Cognito, DynamoDB, S3, SNS, and the Bedrock permissions used by the backend.
- The Lambda currently handles `GET /me`, plus `health` and `summarize` demo events when invoked directly.


## Technology

- AWS Lambda with Python 3.13 and Boto3
- Amazon API Gateway HTTP API
- Amazon Cognito User Pool
- Amazon DynamoDB
- Amazon S3
- Amazon SNS
- Amazon Bedrock
- Terraform

## Repository layout

```text
backend/                         Lambda handler and sample events
frontend/                        Static website files
terraform/                       AWS infrastructure configuration
  modules/                       Reusable Terraform modules
.github/workflows/main.yml       Manual Terraform deploy/destroy workflow
```

## Prerequisites

- An AWS account and credentials with permission to manage the resources in `terraform/`.
- Terraform state bucket and GitHub Actions environment configuration (for the GitHub Actions deployment below).
- Access to the selected Amazon Bedrock model or inference profile in the deployment account and Region.
- Python 3.13 for running or packaging the backend locally
- AWS CLI for optional local AWS checks.

## Clone the repository

```sh
git clone https://github.com/TEAM-LOGA/swen-514-repair-cafe.git
cd swen-514-repair-cafe
```

## Development Workflow

1. Create a branch for your changes.
2. Implement and test your changes locally.
3. Open a pull request against the `main` branch.
4. Review the changes and resolve any feedback.
5. Merge after the required approvals and checks are complete.

## Deploy with GitHub Actions

The workflow is manually run from **GitHub → Actions → Repair Cafe terraform_apply and terraform_destroy → Run workflow**. Select `terraform_apply` and the GitHub environment to deploy to.

Configure these GitHub Actions **variables** for the selected environment (and the repository variable where applicable):

| Name | Purpose |
| --- | --- |
| `AWS_REGION` | AWS Region, for example `us-east-1` |
| `BEDROCK_MODEL_ARN` | Bedrock foundation model or inference profile ARN |
| `TF_STATE_BUCKET` | Existing S3 bucket for Terraform state |

Configure these GitHub Actions **secrets** for the selected environment:

| Name | Purpose |
| --- | --- |
| `TF_STATE_KEY` | Must be `state/<environment-name>/terraform.tfstate`, matching the selected GitHub environment |
| `AWS_ACCESS_KEY_ID` | AWS access key for deployment |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key for deployment |
| `AWS_SESSION_TOKEN` | Optional session token when using temporary AWS credentials |

The workflow builds a Python 3.13 Lambda ZIP, runs Terraform, uploads the frontend files, and writes the website and API URLs into the workflow run **Summary** when successful. The Terraform environment name remains `dev`; the selected GitHub environment selects deployment credentials and the state key.

> **Caution:** `terraform_destroy` deletes the application infrastructure. Use it only when you intend to remove that environment.

## Local Terraform setup

Copy the example variables file and fill in the deployment values:

```sh
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

## API and backend notes

The API base URL is the Terraform output `api_url`; the website URL is `frontend_website_url`. API Gateway requires a Cognito access token for its routes.

Implemented API route:

| Method and path | Behavior |
| --- | --- |
| `GET /me` | Returns a simple backend health message and the authenticated Cognito user ID |

The backend also supports direct Lambda demo events. For example, `backend/events/health.json` checks the handler and `backend/events/summary.json` exercises the Bedrock summarization path. Invoke these through the Lambda test interface; they are not API Gateway request formats.

The routes listed in `terraform/modules/api/main.tf` describe planned API surface. Until corresponding handlers are implemented in `backend/app.py`, those routes return `501` and should not be treated as working features.

## Security and deployment notes

- The current Terraform frontend hosting output is an S3 static website URL using HTTP. Set up HTTPS hosting (for example, CloudFront with an appropriate domain and certificate) before using it for real user credentials.
- Keep AWS credentials and other secrets in GitHub Actions secrets or an AWS credential provider, never in source control.
- Review IAM permissions and Terraform plans before deploying changes.

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

## Run the optional volunteer demo

Demo mode creates a synthetic requester, two volunteers, and six example repairs. Use a GitHub environment dedicated to demo data. Start with empty Terraform state for the first deployment of this version.

1. Open the [Repair Cafe workflow](https://github.com/TEAM-LOGA/swen-514-repair-cafe/actions/workflows/main.yml) and click **Run workflow**. Select the branch with the demo changes, choose `terraform_apply` and your demo environment, check **volunteer_demo**, and leave `admin_email` blank.
2. Open the **Website** link in the successful run’s **Summary**.
3. Use separate browser profiles to keep the three sessions open together. The password for each account is `password`.

| Account | Sign-in email |
| --- | --- |
| Requester | `requester@example.invalid` |
| Volunteer A | `volunteer-a@example.invalid` |
| Volunteer B | `volunteer-b@example.invalid` |

### Walk through the demo

1. As the requester, open **My repair requests** to see **Desk Lamp** and **Wobbly Chair** waiting for a volunteer, **USB Keyboard** and **Portable Fan** in progress, **Bicycle Bell** completed and acknowledged, and **Backpack Zipper** unresolved and awaiting acknowledgement. Open the repair notes and use **My repair history** to filter terminal outcomes.
2. As Volunteer A, find **USB Keyboard** and **Bicycle Bell** under **My claimed requests**. As Volunteer B, find **Portable Fan** and **Backpack Zipper**. Search for any of those items from the other volunteer’s dashboard to see who claimed it.
3. Search for `dEsK lAmP` in both volunteer sessions. Claim the lamp as Volunteer A, then try the same claim from Volunteer B’s stale results to see the conflict. Release it from Volunteer A’s dashboard to make it available again.
4. To try adding a note, changing the status, and acknowledging the outcome, submit a new repair. Claim it as either volunteer, add a note, mark it complete, then acknowledge it as the requester.
5. To demonstrate document extraction, download the [sample repair label](docs/demo-repair-label.png) and attach it to a new request. After submission, open the extracted text to see the confidence scores. Use **Edit text** to correct a line and save it.

Keep **volunteer_demo** checked for redeployments. The workflow restores the shared demo password and fills in any missing example requests. It preserves changes to existing requests. To remove the deployment, run `terraform_destroy` with **volunteer_demo** checked and select the same GitHub environment. This removes the demo accounts and application data in that environment.

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

- The standard deployment uses the HTTP S3 website endpoint. The volunteer demo uses the HTTPS S3 object endpoint for `index.html`.
- Keep AWS credentials and other secrets in GitHub Actions secrets or an AWS credential provider, never in source control.
- Review IAM permissions and Terraform plans before deploying changes.

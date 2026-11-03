import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";

// load the configuration generated for the selected deployment's AWS account.
export async function configureAuth() {
  const response = await fetch("./config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load the deployed authentication configuration.");
  }

  const config = await response.json();
  if (
    typeof config.cognitoUserPoolId !== "string" ||
    !config.cognitoUserPoolId.trim() ||
    typeof config.cognitoClientId !== "string" ||
    !config.cognitoClientId.trim()
  ) {
    throw new Error("The deployment is missing its Cognito configuration.");
  }

  if (typeof config.apiUrl !== "string" || !config.apiUrl.startsWith("https://")) {
    throw new Error("The deployment is missing its HTTPS API URL.");
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.cognitoUserPoolId,
        userPoolClientId: config.cognitoClientId,
        loginWith: { email: true },
      },
    },
  });

  return config;
}

// API Gateway requires the Cognito access token, not the ID token.
export async function fetchProfile(config) {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken;
  if (!token) throw new Error("Your session has expired. Please log in again.");

  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}/me`, {
    headers: { Authorization: `Bearer ${token.toString()}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`The backend request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

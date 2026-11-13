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
export async function apiRequest(config, path, { method = "GET", body, signal } = {}) {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken;
  if (!token) throw new Error("Your session has expired. Please log in again.");

  const headers = { Authorization: `Bearer ${token.toString()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, config.apiUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || `The backend request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

export function fetchProfile(config) {
  return apiRequest(config, "/me");
}

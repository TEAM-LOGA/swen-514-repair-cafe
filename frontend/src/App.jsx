import RepairRequests from "./RepairRequests.jsx";
import VolunteerRequests from "./VolunteerRequests.jsx";
import { useEffect, useState } from "react";
import { getCurrentUser, signIn, signOut } from "aws-amplify/auth";
import { configureAuth, fetchProfile } from "./auth.js";

export default function App() {
  // track deployment settings, the signed in user, and request status
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [apiError, setApiError] = useState("");

  // on page load, configure Cognito and restore an existing Amplify session
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const settings = await configureAuth();
        if (!active) return;
        setConfig(settings);
        let current;
        try {
          current = await getCurrentUser();
        } catch (sessionError) {
          // Having no saved session is normal: leave the login form visible.
          if (sessionError.name !== "UserUnAuthenticatedException") throw sessionError;
          return;
        }
        if (!active) return;
        setUser(current);
        try {
          const result = await fetchProfile(settings);
          if (active) setProfile(result);
        } catch {
          if (active) setApiError("Signed in, but unable to reach the backend. Try checking the connection again.");
        }
      } catch {
        if (active) setError("Authentication could not be initialized. Check that this site's config.json belongs to a deployed environment.");
      } finally {
        if (active) setLoading(false);
      }
    }
    initialize();
    // ignore pending results if React removes this component from the page
    return () => { active = false; };
  }, []);

  // call GET /me
  // auth.js attaches the Cognito access token
  // API errors are separate because a user can be signed in even if the API fails
  async function checkBackend() {
    setApiError("");
    try {
      setProfile(await fetchProfile(config));
    } catch (requestError) {
      setApiError(requestError instanceof TypeError
        ? "Unable to reach the API. Check the deployment and its allowed frontend origin."
        : requestError.message);
    }
  }

  // submit credentials then verify API access.
  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await signIn({
        username: email.trim(), password,
        options: { authFlowType: "USER_SRP_AUTH" },
      });
      if (!result.isSignedIn) {
        // These accounts need another step; this form currently handles login only.
        const step = result.nextStep.signInStep;
        setError(step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
          ? "This account requires a new password. Complete account setup before using this login form."
          : step === "CONFIRM_SIGN_UP"
            ? "Please verify your email before logging in."
            : "Additional account verification is required before login can finish.");
        return;
      }
      setUser(await getCurrentUser());
      await checkBackend();
    } catch (signInError) {
      const messages = {
        NotAuthorizedException: "Account not found or password incorrect.",
        UserNotFoundException: "Account not found or password incorrect.",
        UserNotConfirmedException: "Please verify your email before logging in.",
        PasswordResetRequiredException: "Your password must be reset before you can log in.",
      };
      setError(messages[signInError.name] || "Unable to log in. Please check your connection and try again.");
    } finally {
      // clear the password from React state after every login attempt
      setPassword("");
      setBusy(false);
    }
  }

  // end the local Amplify session and clear account specific UI data
  async function handleLogout() {
    setBusy(true);
    setError("");
    try {
      await signOut();
      setUser(null);
      setProfile(null);
      setApiError("");
      setPassword("");
    } catch {
      setError("Unable to log out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Fix-It Lab home">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span>Fix-It Lab <span className="brand-light">Repair Cafe</span></span>
        </a>
        <span className="header-note">A little care goes a long way</span>
      </header>
      <div className="page-content" id="top">
        {!user && <div className="welcome-copy">
          <p className="eyebrow">Community repair, made simple</p>
          <h1>Give good things<br /><span>another chance.</span></h1>
          <p className="intro-copy">Connect with local volunteer fixers and keep the things you love in use.</p>
        </div>}
      {/* Show loading, the signed-in account, or the login form. */}
      {loading ? <p role="status">Loading authentication…</p> : user ? (
        <section className="account-panel" aria-labelledby="account-heading">
          <h2 id="account-heading">Your account</h2>
          <div className="account-bar"><p>Signed in as <strong>{user.signInDetails?.loginId || user.username}</strong></p>
            <button className="button button-quiet" type="button" disabled={busy} onClick={handleLogout}>Log out</button></div>
          <details className="connection-details">
            <summary>Connection details</summary>
            {profile && <div role="status"><p>{profile.message}</p><p>User ID: {profile.user_id}</p></div>}
            {apiError && <p role="alert">{apiError}</p>}
            <button className="button button-quiet" type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await checkBackend(); } finally { setBusy(false); }
            }}>Check backend connection</button>
          </details>
          {!profile && !apiError && <p role="status">Loading your workspace…</p>}
          {profile?.is_volunteer === true && <VolunteerRequests key={user.userId} config={config} />}
          {profile?.is_volunteer === false && <RepairRequests key={user.userId} config={config} />}
        </section>
      ) : (
        <form className="login-card" onSubmit={handleLogin} aria-labelledby="login-heading">
          <span className="card-icon" aria-hidden="true">↗</span>
          <h2 id="login-heading">Log in</h2>
          <p className="muted">Welcome back. Sign in to manage your repair requests.</p>
          <fieldset disabled={!config || busy}>
            <legend className="sr-only">Account credentials</legend>
            <p><label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" autoComplete="username" required
                value={email} onChange={(event) => setEmail(event.target.value)} /></p>
            <p><label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required
                value={password} onChange={(event) => setPassword(event.target.value)} /></p>
            <button className="button button-primary button-wide" type="submit">{busy ? "Logging in…" : "Log in"}<span aria-hidden="true"> →</span></button>
          </fieldset>
          <p className="login-note">Use the demo account provided by your team.</p>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      </div>
      <footer className="site-footer"><span>Repair together. Waste less.</span><span>Fix-It Lab Repair Cafe</span></footer>
    </main>
  );
}

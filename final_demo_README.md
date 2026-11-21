# Final demo: steps in order

## 1. Deploy the CORS change (once)

* In GitHub, open the Repair Cafe workflow and click **Run workflow**.
* Select the `final-demo` branch and choose `terraform_apply` with your demo environment. Keep **volunteer_demo** checked, so the demo accounts exist.
* Wait for it to succeed, then copy the **Website** link from the run Summary.
* Until this finishes, the local copy's API calls will fail with CORS errors.

## 2. Run the script

From the repo root in PowerShell, using the Website link:

```powershell
.\scripts\serve-demo.ps1 -SiteUrl <website-url>
```

* It builds the frontend, downloads `config.json` and starts the servers. Leave the window open, because Ctrl+C stops the servers.
* Check that it prints `config.json OK (API: ...)` and the three URLs.
* You'll need Node installed. If PowerShell blocks the script, run it as `powershell -ExecutionPolicy Bypass -File .\scripts\serve-demo.ps1 -SiteUrl <website-url>`.

## 3. Rehearse the deck

* Open `http://localhost:3001/` in Chrome and press → to reach slide 4, the live slide.
* Sign in as `requester@repaircafe.com` on the left and `volunteer-a@repaircafe.com` on the right. The password is `password`.
* Run the README walkthrough: the requester submits a repair, the volunteer claims it, adds a note and marks it complete, then the requester refreshes and acknowledges it.
* Click the dark background to give the arrow keys back to the deck. Press `R` to reload both panes, which also signs you out.

## 4. Before presenting

* Sign in again just before you start. Access tokens last 15 minutes, though the 7-day refresh token should keep a session alive.
* Reload a pane after a volunteer action if the requester's view doesn't update by itself.
* Keep the script window open and your laptop online throughout.

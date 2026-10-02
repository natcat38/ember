# Connects the production Telegram bot to the ember-tasks Worker (Tech_Scope.md §6, slices 11-13).
# Before running: create the bot with @BotFather and copy the token it gives you. Leave it on the clipboard.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\set-telegram.ps1
# What it does, without ever printing a secret:
#   1. reads the token from the clipboard, checks it with Telegram (getMe), and learns the bot's username;
#   2. makes two random values, the webhook secret and the webhook path;
#   3. stores TG_BOT_TOKEN, TG_WEBHOOK_SECRET and TG_WEBHOOK_PATH as Worker secrets;
#   4. registers the webhook with Telegram (messages and button taps only);
#   5. writes the username into wrangler.jsonc and clears the clipboard.
# Then commit the one wrangler.jsonc line and deploy. Running it again makes new random values and re-registers: harmless.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$token = (Get-Clipboard -Raw).Trim()
if ($token -notmatch '^\d+:[A-Za-z0-9_-]{30,}$') { throw 'The clipboard does not hold a bot token. Copy the token from @BotFather and run this again.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe"
if (-not $me.ok) { throw 'Telegram did not accept that token.' }
$username = $me.result.username
"Bot found: @$username"

function RandomValue { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
$secret = RandomValue
$path = RandomValue

$token | npx.cmd wrangler secret put TG_BOT_TOKEN
if ($LASTEXITCODE -ne 0) { throw 'Setting TG_BOT_TOKEN failed. Nothing else was changed.' }
$secret | npx.cmd wrangler secret put TG_WEBHOOK_SECRET
if ($LASTEXITCODE -ne 0) { throw 'Setting TG_WEBHOOK_SECRET failed. Run the script again.' }
$path | npx.cmd wrangler secret put TG_WEBHOOK_PATH
if ($LASTEXITCODE -ne 0) { throw 'Setting TG_WEBHOOK_PATH failed. Run the script again.' }

# The origin is the one the Worker already uses for its own links.
$jsonc = (Resolve-Path .\wrangler.jsonc).Path
$text = [System.IO.File]::ReadAllText($jsonc)
if ($text -notmatch '"APP_ORIGIN": "(https://[^"]+)"') { throw 'wrangler.jsonc has no APP_ORIGIN.' }
$origin = $Matches[1]
$body = @{ url = "$origin/api/tg/$path"; secret_token = $secret; allowed_updates = @('message', 'callback_query'); drop_pending_updates = $true } | ConvertTo-Json
$hook = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType 'application/json' -Body $body
if (-not $hook.ok) { throw "Telegram refused the webhook: $($hook.description)" }
"Webhook registered."

$new = $text -replace '"TG_BOT_USERNAME": "[^"]*"', ('"TG_BOT_USERNAME": "' + $username + '"')
if ($new -eq $text -and $text -notmatch ('"TG_BOT_USERNAME": "' + $username + '"')) { throw 'wrangler.jsonc has no TG_BOT_USERNAME line.' }
[System.IO.File]::WriteAllText($jsonc, $new, (New-Object System.Text.UTF8Encoding $false))
cmd /c "echo off | clip"
Remove-Variable token, secret, path, body
"Done. @$username is written into wrangler.jsonc and the clipboard is cleared. Commit that line, then deploy."

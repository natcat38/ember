# Creates the web push (VAPID) key pair and sets it on the ember-tasks Worker (Tech_Scope.md §10, slice 18).
# Run once, from anywhere:  powershell -ExecutionPolicy Bypass -File scripts\set-vapid.ps1
# The private key goes straight into `wrangler secret put` and is never printed or written to disk. The contact is
# mailto: plus your git email. The public key is written into wrangler.jsonc; commit that one line, then deploy.
# Running it again makes a new pair and breaks every existing subscription.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$email = git config user.email
if (-not $email) { throw 'git config user.email is empty. Set it first.' }
function B64u([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
$ec = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
$p = $ec.ExportParameters($true)
$pub = B64u ([byte[]](,4 + $p.Q.X + $p.Q.Y))
$priv = B64u $p.D
$priv | npx.cmd wrangler secret put VAPID_PRIVATE_KEY
if ($LASTEXITCODE -ne 0) { throw 'Setting VAPID_PRIVATE_KEY failed. Nothing else was changed.' }
"mailto:$email" | npx.cmd wrangler secret put VAPID_SUBJECT
if ($LASTEXITCODE -ne 0) { throw 'Setting VAPID_SUBJECT failed. Run the script again: a new key pair replaces the secret.' }
$path = (Resolve-Path .\wrangler.jsonc).Path
$text = [System.IO.File]::ReadAllText($path)
$new = $text -replace '"VAPID_PUBLIC_KEY": "[^"]*"', ('"VAPID_PUBLIC_KEY": "' + $pub + '"')
if ($new -eq $text) { throw 'wrangler.jsonc has no VAPID_PUBLIC_KEY line.' }
[System.IO.File]::WriteAllText($path, $new, (New-Object System.Text.UTF8Encoding $false))
Remove-Variable priv, p, ec
"Done. The public key is in wrangler.jsonc. Commit that line, then deploy."

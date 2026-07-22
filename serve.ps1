# Minimal static file server for the currency converter.
#
# Why this exists: opening index.html straight from disk (file://) can get the
# API call blocked by the browser's cross-origin rules. Serving over
# http://localhost avoids that entirely. Needs nothing installed — this is
# plain PowerShell.
#
# Run it:   powershell -ExecutionPolicy Bypass -File serve.ps1
# Stop it:  Ctrl+C

param(
  [int]$Port = 8123,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Host "Couldn't start on port $Port. It may already be in use." -ForegroundColor Red
  Write-Host "Try a different one:  .\serve.ps1 -Port 8080"
  exit 1
}

Write-Host ""
Write-Host "  Currency converter running at http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

    # Don't serve anything outside this folder.
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($Root))) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }

    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctype = $types[$ext]
      if (-not $ctype) { $ctype = "application/octet-stream" }

      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType = $ctype
      # No caching, so edits show up on a plain refresh.
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch {
    # A dropped connection shouldn't take the server down.
    Write-Host "  request error: $($_.Exception.Message)" -ForegroundColor DarkGray
  }
}

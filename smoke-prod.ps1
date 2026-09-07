$secureString = Read-Host "Ingresa la contrasena de admin@baitprepago.mx para humo productivo" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
$plainText = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$baseUrl = "https://baitprepago2.vercel.app"
$email = "admin@baitprepago.mx"

Write-Output "--- LOGIN PRODUCTIVO ---" | Out-File -Append smoke-results.txt
$loginBody = @{ email = $email; password = $plainText } | ConvertTo-Json

try {
    $loginRes = Invoke-WebRequest -Uri "$baseUrl/api/admin/login" -Method Post -Body $loginBody -ContentType "application/json" -SessionVariable session -ErrorAction Stop
    Write-Output "LOGIN: 200 PASS" | Out-File -Append smoke-results.txt
} catch {
    Write-Output "LOGIN FAILED: $($_.Exception.Response.StatusCode.value__)" | Out-File -Append smoke-results.txt
    exit 1
}

$endpoints = @(
    "/api/admin/session",
    "/api/admin/overview",
    "/api/admin/leads",
    "/api/admin/analytics",
    "/api/admin/users",
    "/api/admin/settings"
)

foreach ($ep in $endpoints) {
    try {
        $res = Invoke-WebRequest -Uri "$baseUrl$ep" -WebSession $session -ErrorAction Stop
        Write-Output "$ep : $($res.StatusCode) PASS" | Out-File -Append smoke-results.txt
    } catch {
        Write-Output "$ep : $($_.Exception.Response.StatusCode.value__) FAIL" | Out-File -Append smoke-results.txt
    }
}

Write-Output "--- LOGOUT ---" | Out-File -Append smoke-results.txt
try {
    $logoutRes = Invoke-WebRequest -Uri "$baseUrl/api/admin/logout" -Method Post -WebSession $session -ErrorAction Stop
    Write-Output "LOGOUT: 200 PASS" | Out-File -Append smoke-results.txt
} catch {
    Write-Output "LOGOUT FAILED: $($_.Exception.Response.StatusCode.value__)" | Out-File -Append smoke-results.txt
}

Write-Output "--- SESSION AFTER LOGOUT ---" | Out-File -Append smoke-results.txt
try {
    $res = Invoke-WebRequest -Uri "$baseUrl/api/admin/session" -WebSession $session -ErrorAction Stop
    Write-Output "SESSION AFTER LOGOUT: $($res.StatusCode) FAIL (Expected 401)" | Out-File -Append smoke-results.txt
} catch {
    Write-Output "SESSION AFTER LOGOUT: $($_.Exception.Response.StatusCode.value__) PASS (401)" | Out-File -Append smoke-results.txt
}

$plainText = $null
$secureString = $null

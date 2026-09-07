$secureString = Read-Host "Ingresa la contraseña productiva de admin@baitprepago.mx" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
$plainText = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$env:PROD_ADMIN_PASSWORD = $plainText
$env:PROD_ADMIN_EMAIL = "admin@baitprepago.mx"

Write-Output "Ejecutando suite de Smoke tests..."
node tests/smoke-production.js > smoke-results.txt

$env:PROD_ADMIN_PASSWORD = $null
$env:PROD_ADMIN_EMAIL = $null

Write-Output "Pruebas terminadas. Revisa smoke-results.txt y dímelo al agente."

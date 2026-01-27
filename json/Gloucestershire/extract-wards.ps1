# Extract ward data from ModernGov councils
# Reads councils.json and scrapes ward IDs from mgFindMember.aspx

# Read councils configuration
$councilsJson = Get-Content -Path "councils.json" -Raw | ConvertFrom-Json

# Create base output directory
$outputDir = "council_data"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

foreach ($council in $councilsJson.councils) {
    Write-Host "Processing: $($council.name)" -ForegroundColor Cyan
    
    # Create council-specific directory
    $councilSlug = $council.name -replace '\s+', '_' -replace '[^\w-]', ''
    $councilDir = Join-Path $outputDir $councilSlug
    if (-not (Test-Path $councilDir)) {
        New-Item -ItemType Directory -Path $councilDir | Out-Null
    }
    
    # Construct the mgFindMember.aspx URL
    $findMemberUrl = "$($council.url)/mgFindMember.aspx"
    
    try {
        # Fetch the page
        Write-Host "  Fetching: $findMemberUrl" -ForegroundColor Gray
        $response = Invoke-WebRequest -Uri $findMemberUrl -UseBasicParsing
        
        # Extract ward select options using regex
        # Looking for: <option value="123">Ward Name</option>
        $pattern = '<option value="(\d+)"[^>]*>([^<]+)</option>'
        $matches = [regex]::Matches($response.Content, $pattern)
        
        # Build ward data structure
        $wards = @()
        foreach ($match in $matches) {
            $wardId = $match.Groups[1].Value
            $wardName = $match.Groups[2].Value.Trim()
            
            # Skip "Select a ward" or value="0" options
            if ($wardId -ne "0" -and $wardName -notmatch "^Select") {
                $wards += @{
                    "id" = $wardId
                    "name" = $wardName
                }
            }
        }
        
        # Create output object
        $output = @{
            "council" = $council.name
            "url" = $council.url
            "scraped_at" = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            "ward_count" = $wards.Count
            "wards" = $wards
        }
        
        # Save to JSON file
        $outputFile = Join-Path $councilDir "wards.json"
        $output | ConvertTo-Json -Depth 10 | Set-Content -Path $outputFile
        
        Write-Host "  ✓ Found $($wards.Count) wards" -ForegroundColor Green
        Write-Host "  ✓ Saved to: $outputFile" -ForegroundColor Green
        
    } catch {
        Write-Host "  ✗ Error: $($_.Exception.Message)" -ForegroundColor Red
        
        # Save error info
        $errorOutput = @{
            "council" = $council.name
            "url" = $council.url
            "error" = $_.Exception.Message
            "scraped_at" = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        }
        $errorFile = Join-Path $councilDir "error.json"
        $errorOutput | ConvertTo-Json -Depth 10 | Set-Content -Path $errorFile
    }
    
    # Be respectful - pause between requests
    Start-Sleep -Seconds 2
}

Write-Host "`nComplete! Ward data saved to: $outputDir" -ForegroundColor Cyan
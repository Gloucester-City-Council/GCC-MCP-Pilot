# Extract enriched committee data from ModernGov councils
# Reads councils.json and scrapes committee details for each council

$ErrorActionPreference = "Stop"

# Configuration
$DelayMs = 250
$TimeoutSec = 20
$MaxRetries = 2

$Headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell"
  "Accept"     = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
}

# Utility functions
function To-Bool([object]$v) {
  if ($null -eq $v) { return $false }
  return ($v.ToString().Trim().ToLowerInvariant() -eq "true")
}

function To-NullOrString([object]$v) {
  if ($null -eq $v) { return $null }
  $s = $v.ToString().Trim()
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  return $s
}

function HtmlDecode([string]$s) {
  return [System.Net.WebUtility]::HtmlDecode($s)
}

function StripHtml([string]$html) {
  if ([string]::IsNullOrWhiteSpace($html)) { return "" }
  $t = [regex]::Replace($html, "<script[\s\S]*?</script>", "", "IgnoreCase")
  $t = [regex]::Replace($t, "<style[\s\S]*?</style>", "", "IgnoreCase")
  $t = [regex]::Replace($t, "<[^>]+>", " ")
  $t = HtmlDecode $t
  $t = [regex]::Replace($t, "\s+", " ").Trim()
  return $t
}

function Invoke-WebRequestWithRetry([string]$Uri) {
  for ($i = 0; $i -le $MaxRetries; $i++) {
    try {
      $splat = @{
        Uri = $Uri
        Headers = $Headers
        Method = "GET"
        UseBasicParsing = $true
      }

      if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey("TimeoutSec")) {
        $splat["TimeoutSec"] = $TimeoutSec
      }

      return (Invoke-WebRequest @splat)
    }
    catch {
      if ($i -ge $MaxRetries) { throw }
      Start-Sleep -Milliseconds (250 * ($i + 1))
    }
  }
}

function Get-SectionBodyHtml([string]$html, [string]$wantedTitle) {
  $sections = [regex]::Matches(
    $html,
    '(?is)<h2[^>]*class="[^"]*\bmgSectionTitle\b[^"]*"[^>]*>(?<title>.*?)</h2>\s*(?<body>.*?)(?=<h2[^>]*class="[^"]*\bmgSectionTitle\b[^"]*"[^>]*>|$)'
  )

  foreach ($s in $sections) {
    $titleText = StripHtml $s.Groups["title"].Value
    if ($titleText) {
      if ($titleText.Trim().ToLowerInvariant() -eq $wantedTitle.Trim().ToLowerInvariant()) {
        return $s.Groups["body"].Value
      }
    }
  }
  return $null
}

function Extract-Purpose([string]$html) {
  $candidates = @(
    "Purpose of committee",
    "Purpose",
    "Role",
    "Terms of reference",
    "Terms of Reference"
  )

  foreach ($t in $candidates) {
    $body = Get-SectionBodyHtml -html $html -wantedTitle $t
    if ($null -ne $body) {
      $txt = StripHtml $body
      if (-not [string]::IsNullOrWhiteSpace($txt)) {
        return $txt
      }
    }
  }
  return $null
}

function Extract-Members([string]$html) {
  $body = Get-SectionBodyHtml -html $html -wantedTitle "Membership"
  if ($null -eq $body) { return @() }

  $lis = [regex]::Matches($body, '(?is)<li[^>]*>(?<li>.*?)</li>')
  $members = @()

  foreach ($li in $lis) {
    $liHtml = $li.Groups["li"].Value

    $a = [regex]::Match($liHtml, '(?is)<a[^>]*href="mgUserInfo\.aspx\?UID=(?<uid>\d+)"[^>]*>(?<name>.*?)</a>')
    if (-not $a.Success) { continue }

    $uid = [int]$a.Groups["uid"].Value
    $name = StripHtml $a.Groups["name"].Value

    $liText = StripHtml $liHtml
    $role = $null
    $rm = [regex]::Match($liText, '\((?<role>[^)]+)\)')
    if ($rm.Success) { $role = $rm.Groups["role"].Value.Trim() }

    $members += [pscustomobject]@{
      uid  = $uid
      name = $name
      role = $role
    }
  }

  return $members
}

function Extract-Contact([string]$html) {
  $body = Get-SectionBodyHtml -html $html -wantedTitle "Contact information"
  if ($null -eq $body) { return $null }

  $support = $null
  $m = [regex]::Match($body, '(?is)Support officer:\s*</span>\s*(?<v>.*?)(?:</p>|<br\s*/?>)', 'IgnoreCase')
  if ($m.Success) { $support = StripHtml $m.Groups["v"].Value }

  $addressLines = @()
  $m = [regex]::Match($body, '(?is)Postal address:\s*</span>\s*(?<v>.*?)</p>', 'IgnoreCase')
  if ($m.Success) {
    $raw = HtmlDecode $m.Groups["v"].Value
    $parts = [regex]::Split($raw, '(?is)<br\s*/?>')
    $addressLines = $parts | ForEach-Object { StripHtml $_ } | Where-Object { $_ -and $_.Trim().Length -gt 0 }
  }

  $phone = $null
  $m = [regex]::Match($body, '(?is)Phone:\s*</span>\s*(?<v>.*?)(?:</p>|<br\s*/?>)', 'IgnoreCase')
  if ($m.Success) { $phone = StripHtml $m.Groups["v"].Value }

  $email = $null
  $m = [regex]::Match($body, '(?is)mailto:(?<v>[^"]+)"', 'IgnoreCase')
  if ($m.Success) { $email = HtmlDecode $m.Groups["v"].Value }

  return [pscustomobject]@{
    supportOfficer = (To-NullOrString $support)
    postalAddress  = $addressLines
    phone          = (To-NullOrString $phone)
    email          = (To-NullOrString $email)
  }
}

function Suggest-Purpose([string]$title, [string]$category, [string]$councilName) {
  $t = ""
  if ($title) { $t = $title.Trim() }
  $c = ""
  if ($category) { $c = $category.Trim() }
  $cn = ""
  if ($councilName) { $cn = $councilName.Trim() }

  $lc = ($t + " " + $c).ToLowerInvariant()
  $isTewkesbury = ($cn.ToLowerInvariant() -match 'tewkesbury')

  # Full Council
  if (($t.ToLowerInvariant() -eq "council") -or ($lc -match '\bfull council\b')) {
    if ($isTewkesbury) {
      return "Suggested: Full Council setting the budget and policy framework. Under the fourth option executive model, Council also exercises executive functions not delegated to committees."
    }
    return "Suggested: Full Council setting the budget and policy framework and taking key decisions reserved to Council, including appointments and constitutional matters."
  }
  
  # Executive Committee (Fourth Option specific)
  if ($lc -match '\bexecutive committee\b' -and $isTewkesbury) {
    return "Suggested: Under the fourth option executive arrangements, this committee exercises executive functions delegated by Full Council, coordinating strategic delivery across the authority."
  }
  
  # Cabinet/Executive (Leader and Cabinet model)
  if ($lc -match '\bcabinet\b|\bexecutive\b' -and -not $isTewkesbury) {
    return "Suggested: Executive decision-making body responsible for day-to-day decisions within the Council's executive remit and making recommendations to full Council on major policies and budgets."
  }
  
  # Overview and Scrutiny - enhanced for fourth option
  if ($lc -match '\boverview and scrutiny\b|\bscrutiny\b') {
    if ($isTewkesbury) {
      return "Suggested: Scrutinises decisions made by the Executive Committee and other committees, reviews performance, and may commission in-depth reviews on priority issues."
    }
    return "Suggested: Scrutinises decisions and performance, acts as a 'critical friend' to the executive, and may commission task and finish work on priority issues."
  }
  
  # Audit, Governance and Standards Committee (Tewkesbury pattern)
  if ($lc -match '\baudit.*governance.*standards\b|\bgovernance.*audit.*standards\b') {
    return "Suggested: Combined committee overseeing governance, risk management, internal controls, audit arrangements, and member conduct standards."
  }
  
  # Audit and Governance (without Standards)
  if ($lc -match '\baudit.*governance\b|\bgovernance.*audit\b') {
    return "Suggested: Oversees governance, risk management, internal controls, and audit arrangements; reviews assurances and compliance on key corporate matters."
  }
  
  # Standards Committee
  if ($lc -match '\bstandards\b') {
    return "Suggested: Supports and determines matters relating to member conduct and standards, including hearings/panels where applicable."
  }
  
  # Planning Committee - fourth option context
  if ($lc -match '\bplanning\b') {
    if ($isTewkesbury) {
      return "Suggested: Exercises delegated planning functions, determining applications and related planning matters. Under fourth option arrangements, operates with delegated executive powers for planning decisions."
    }
    return "Suggested: Determines planning applications and related planning matters that are reserved to committee, following officer recommendations and relevant planning policy."
  }
  
  # Licensing variations
  if ($lc -match '\blicensing\b') {
    return "Suggested: Exercises the Council's licensing and related enforcement functions (and/or sub-committee hearings) within the relevant statutory framework."
  }
  
  # Development Control (Stroud pattern - alternative to Planning)
  if ($lc -match '\bdevelopment control\b') {
    return "Suggested: Determines planning and development applications that are reserved to committee, considering policy compliance and officer recommendations."
  }
  
  # Strategy and Resources (Stroud pattern)
  if ($lc -match '\bstrategy.*resources\b|\bresources.*strategy\b') {
    return "Suggested: Oversees strategic direction, financial planning, budget management, and resource allocation across the council's operations."
  }
  
  # Community Services and Licensing (Stroud pattern)
  if ($lc -match '\bcommunity services.*licensing\b|\bcommunity.*licensing\b') {
    return "Suggested: Oversees community facilities, leisure services, environmental health, and exercises licensing functions for the authority."
  }
  
  # Environment Committee (Stroud pattern)
  if ($lc -match '\benvironment\b' -and -not ($lc -match '\benvironmental health\b')) {
    return "Suggested: Oversees environmental policy, climate change initiatives, waste management, and sustainability strategies."
  }
  
  # Housing Committee (Stroud pattern)
  if ($lc -match '\bhousing\b') {
    return "Suggested: Oversees housing policy, homelessness services, council housing management, and housing strategy delivery."
  }
  
  # Employment Committee (Tewkesbury pattern)
  if ($lc -match '\bemployment\b' -and -not ($lc -match '\bunemployment\b')) {
    return "Suggested: Oversees staffing matters, senior appointments, HR policies, workforce planning, and employment-related decisions."
  }
  
  # General Purposes
  if ($lc -match '\bgeneral purposes\b') {
    return "Suggested: Handles a range of general delegated matters not otherwise assigned to another committee, often including procedural/governance or miscellaneous functions."
  }
  
  # Constitution Committee
  if ($lc -match '\bconstitution\b') {
    return "Suggested: Maintains and oversees the Council's Constitution and associated governance arrangements, ensuring it remains current and fit for purpose."
  }
  
  # Senior Appointments
  if ($lc -match '\bsenior appointments\b|\bappointments\b') {
    return "Suggested: Oversees the recruitment/appointment process for senior officers and makes appointment recommendations/decisions in line with the Council's constitution."
  }
  
  # Member Development/Training
  if ($lc -match '\bmember development\b|\bmember training\b') {
    return "Suggested: Supports councillor development through training programmes, induction, and continuing professional development opportunities."
  }
  
  # Joint committees and partnerships
  if ($lc -match '\bjoint\b|\bpartnership\b') {
    return "Suggested: Joint committee working in partnership with other authorities or organisations on shared services, strategic initiatives, or statutory requirements."
  }
  
  # Appeals and review committees
  if ($lc -match '\bappeals\b|\breview\b') {
    return "Suggested: Hears appeals against officer decisions and reviews cases within the committee's delegated authority, ensuring fair and transparent decision-making."
  }
  
  # Policy committees (general)
  if ($lc -match '\bpolicy\b') {
    return "Suggested: Develops and recommends policy frameworks within its area of responsibility, supporting the executive and full council decision-making."
  }
  
  # Service-specific committees
  if ($lc -match '\bleisure\b|\bculture\b|\barts\b') {
    return "Suggested: Oversees leisure facilities, cultural services, arts provision, and related community amenities within the council's remit."
  }
  
  if ($lc -match '\beconomic development\b|\beconomy\b') {
    return "Suggested: Supports economic growth, business development, regeneration projects, and employment initiatives within the local area."
  }
  
  if ($lc -match '\bclimate change\b|\bclimate\b') {
    return "Suggested: Leads on climate change strategy, carbon reduction targets, environmental sustainability, and climate adaptation measures."
  }
  
  # Trust/Management committees
  if ($lc -match '\btrust\b|\bmanagement committee\b|\brecreation ground\b') {
    return "Suggested: Manages the relevant trust/asset and associated governance, including oversight of operations, funding, and stewardship responsibilities."
  }
  
  # Working groups and panels
  if ($lc -match '\bworking group\b|\bpanel\b|\btask.*finish\b') {
    return "Suggested: Time-limited group examining specific issues or projects in detail, reporting findings and recommendations to the parent committee or council."
  }
  
  # Sub-committees
  if ($lc -match '\bsub-committee\b|\bsub committee\b') {
    return "Suggested: Sub-committee exercising delegated powers from its parent committee within a specific area of responsibility or for particular types of decisions."
  }

  # Category-based fallback
  if (-not [string]::IsNullOrWhiteSpace($c)) {
    return "Suggested: A committee within the '$c' area, overseeing decisions and governance relevant to '$t'."
  }

  # Generic fallback
  return "Suggested: Oversees and supports Council business related to '$t' in line with the Council's constitution and delegated functions."
}

# Read councils configuration
$councilsJson = Get-Content -Path "councils.json" -Raw | ConvertFrom-Json

# Create base output directory
$outputDir = "council_data"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

foreach ($council in $councilsJson.councils) {
    Write-Host "`n================================================" -ForegroundColor Cyan
    Write-Host "Processing: $($council.name)" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    
    # Create council-specific directory
    $councilSlug = $council.name -replace '\s+', '_' -replace '[^\w-]', ''
    $councilDir = Join-Path $outputDir $councilSlug
    if (-not (Test-Path $councilDir)) {
        New-Item -ItemType Directory -Path $councilDir | Out-Null
    }
    
    $baseUrl = $council.url
    $committeesUrl = "$baseUrl/mgWebService.asmx/GetCommittees"
    
    try {
        # --- 1) Fetch committee index ---
        Write-Host "Fetching committee list..." -ForegroundColor Gray
        $indexResp = Invoke-WebRequestWithRetry $committeesUrl
        if (-not $indexResp.Content) { throw "Empty response from $committeesUrl" }

        [xml]$indexXml = $indexResp.Content
        $allCommittees = $indexXml.committees.committee

        # --- 2) Filter active (not deleted, not expired) ---
        $active = foreach ($c in $allCommittees) {
            $deleted = To-Bool $c.committeedeleted
            $expired = To-Bool $c.committeeexpired
            if ($deleted -or $expired) { continue }

            $id = [int]($c.committeeid.ToString().Trim())
            $title = To-NullOrString $c.committeetitle
            $category = To-NullOrString $c.committeecategory

            [pscustomobject]@{
                id       = $id
                title    = $title
                category = $category
                flags    = [pscustomobject]@{ deleted = $deleted; expired = $expired }
            }
        }

        $active = $active | Sort-Object -Property category, title, id
        Write-Host "Found $($active.Count) active committees" -ForegroundColor Green

        # --- 3) Scrape details + enrich ---
        $enriched = @()
        $failures = 0

        foreach ($c in $active) {
            $id = $c.id
            $detailsUrl = "$baseUrl/mgCommitteeDetails.aspx?ID=$id"

            try {
                Write-Host "  Scraping ID=$id ($($c.title))..." -ForegroundColor Gray

                $page = Invoke-WebRequestWithRetry $detailsUrl
                $html = $page.Content

                $purpose = Extract-Purpose $html
                $members = Extract-Members $html
                $contact = Extract-Contact $html

                $purposeSource = "scraped"
                $purposeSuggested = $null
                $purposeConfidence = "high"

                if ([string]::IsNullOrWhiteSpace($purpose)) {
                    $purposeSource = "suggested"
                    $purposeSuggested = Suggest-Purpose $c.title $c.category $council.name
                    $purposeConfidence = "low"
                    $purpose = $null
                }

                $enriched += [pscustomobject]@{
                    id       = $id
                    title    = $c.title
                    category = $c.category
                    flags    = $c.flags
                    urls     = [pscustomobject]@{
                        details        = $detailsUrl
                        meetings       = "$baseUrl/ieListMeetings.aspx?CommitteeId=$id"
                        membersContact = "$baseUrl/mgCommitteeMailingList.aspx?ID=$id"
                        attendance     = "$baseUrl/mgAttendanceSummary.aspx?RPID=$id"
                        interests      = "$baseUrl/mgListDeclarationsOfInterest.aspx?RPID=$id"
                        rss            = "$baseUrl/mgRss.aspx?CID=$id"
                    }

                    purpose           = $purpose
                    purposeSuggested  = $purposeSuggested
                    purposeSource     = $purposeSource
                    purposeConfidence = $purposeConfidence

                    members = @($members)
                    contact = $contact
                }
            }
            catch {
                $failures++
                Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
                $enriched += [pscustomobject]@{
                    id          = $id
                    title       = $c.title
                    category    = $c.category
                    flags       = $c.flags
                    urls        = [pscustomobject]@{ details = $detailsUrl }
                    scrapeError = $_.Exception.Message
                }
            }

            Start-Sleep -Milliseconds $DelayMs
        }

        # --- 4) Output JSON ---
        $payload = [pscustomobject]@{
            council      = $council.name
            generatedUtc = (Get-Date).ToUniversalTime().ToString("o")
            source       = [pscustomobject]@{
                committeesUrl = $committeesUrl
                baseUrl       = $baseUrl
            }
            counts       = [pscustomobject]@{
                totalInFeed          = [int]($indexXml.committees.committeescount.ToString().Trim())
                activeInOutput       = $active.Count
                scrapeFailures       = $failures
                withPurposeScraped   = ($enriched | Where-Object { $_.purposeSource -eq "scraped" -and $_.purpose }).Count
                withPurposeSuggested = ($enriched | Where-Object { $_.purposeSource -eq "suggested" -and $_.purposeSuggested }).Count
            }
            committees = $enriched
        }

        $outFile = Join-Path $councilDir "committees.json"
        $payload | ConvertTo-Json -Depth 25 | Out-File -FilePath $outFile -Encoding UTF8
        
        Write-Host "✓ Wrote $($enriched.Count) committees (failures: $failures)" -ForegroundColor Green
        Write-Host "✓ Saved to: $outFile" -ForegroundColor Green
        
    } catch {
        Write-Host "✗ Error processing council: $($_.Exception.Message)" -ForegroundColor Red
        
        # Save error info
        $errorOutput = @{
            "council" = $council.name
            "url" = $council.url
            "error" = $_.Exception.Message
            "scraped_at" = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        }
        $errorFile = Join-Path $councilDir "committees_error.json"
        $errorOutput | ConvertTo-Json -Depth 10 | Set-Content -Path $errorFile
    }
    
    # Be respectful - pause between councils
    Start-Sleep -Seconds 2
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "Complete! Committee data saved to: $outputDir" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
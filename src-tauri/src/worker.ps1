$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
function Decode([string]$text) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text)) }
function Encode([string]$text) { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)) }
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ($line -eq 'quit') { break }
    $parts = $line.Split("`t")
    try {
        $in = Decode $parts[0]
        $out = Decode $parts[1]
        $doc = $word.Documents.Open($in, $false, $true)
        try {
            $ext = [System.IO.Path]::GetExtension($out).ToLowerInvariant()
            if ($ext -eq '.pdf') {
                $doc.ExportAsFixedFormat($out, 17)
            } else {
                $fmt = switch ($ext) {
                    '.docx' { 16 }
                    '.html' { 10 }
                    '.txt' { 7 }
                    '.rtf' { 6 }
                    default { throw "Desteklenmeyen belge bicimi: $ext" }
                }
                $doc.SaveAs([ref]$out, [ref]$fmt)
            }
        } finally { $doc.Close(0) }
        [Console]::Out.WriteLine('OK')
    } catch {
        [Console]::Out.WriteLine('ERR ' + (Encode ([string]$_.Exception.Message)))
    }
    [Console]::Out.Flush()
}
try { $word.Quit() } catch { }

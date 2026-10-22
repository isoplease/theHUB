$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function NewWord {
    $w = New-Object -ComObject Word.Application
    $w.Visible = $false
    $w.DisplayAlerts = 0
    return $w
}
$word = NewWord
function Decode([string]$text) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text)) }
function Encode([string]$text) { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)) }
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ($line -eq 'quit') { break }
    $parts = $line.Split("`t")
    $in = Decode $parts[0]
    $out = Decode $parts[1]
    $reply = $null
    # Word calisirken kapatilmis/cokmus olabilir: ilk hata olursa yeniden baslatip bir kez daha dene.
    foreach ($attempt in 1, 2) {
        try {
            if ($null -eq $word) { $word = NewWord }
            $doc = $word.Documents.Open($in, $false, $true)
            if ($null -eq $doc) { throw 'Belge acilamadi' }
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
                    if ($ext -eq '.txt') { $doc.TextEncoding = 65001 }
                    $doc.SaveAs([ref]$out, [ref]$fmt)
                }
            } finally { $doc.Close(0) }
            $reply = 'OK'
            break
        } catch {
            $reply = 'ERR ' + (Encode ([string]$_.Exception.Message))
            if ($attempt -eq 1) {
                try { $word.Quit() } catch { }
                $word = $null
            }
        }
    }
    [Console]::Out.WriteLine($reply)
    [Console]::Out.Flush()
}
try { $word.Quit() } catch { }

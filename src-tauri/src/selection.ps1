$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$shell = New-Object -ComObject Shell.Application
[Console]::Out.WriteLine('READY')
while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
        $parts = $line.Split('|')
        $hwnd = [long]$parts[0]
        $class = $parts[1]
        $items = $null
        if ($class -eq 'WorkerW' -or $class -eq 'Progman') {
            $loc = [ref]0
            $out = [ref]0
            $desktop = $shell.Windows().FindWindowSW($loc, $loc, 8, $out, 1)
            $items = $desktop.Document.SelectedItems()
        } else {
            foreach ($w in $shell.Windows()) {
                if ($w.HWND -eq $hwnd) { $items = $w.Document.SelectedItems(); break }
            }
        }
        foreach ($item in $items) { [Console]::Out.WriteLine($item.Path) }
        [Console]::Out.WriteLine('#D|' + [Environment]::GetFolderPath('Desktop'))
        foreach ($w in $shell.Windows()) {
            try { [Console]::Out.WriteLine('#F|' + $w.HWND + '|' + $w.Document.Folder.Self.Path) } catch { }
        }
    } catch { }
    [Console]::Out.WriteLine('#END')
    [Console]::Out.Flush()
}

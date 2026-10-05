$raw = tailscale status --json 2>$null | Out-String
$o = $raw | ConvertFrom-Json
Write-Output ("SelfHost=" + $o.Self.HostName + " selfIp=" + ($o.Self.TailscaleIPs -join ","))
$peers = $o.Peer.PSObject.Properties.Value
Write-Output ("peerCount=" + $peers.Count)
foreach ($p in $peers) {
  Write-Output ("host=" + $p.HostName + " online=" + $p.Online + " routes=[" + ($p.PrimaryRoutes -join ",") + "]")
}

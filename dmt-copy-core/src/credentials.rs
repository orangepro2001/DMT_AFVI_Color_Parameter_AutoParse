//! UNC share logon via `net use`, moved verbatim from the desktop app so the
//! agent applies the exact same credential and error-code handling.

/// UNC paths (\\\\server\\share\\...) may need a logon before any file access.
/// The stored credentials (machines.json) are applied with `net use` on the
/// IPC$ share of every involved server. A blank password is legitimate - device
/// accounts like `pixel` often have none - so the password is passed as-is (an
/// empty argument becomes `""`, which logs on with a null password instead of
/// prompting); stdin is closed, so `net use` can never hang on a prompt.
#[cfg(windows)]
pub fn ensure_unc_credentials(paths: &[&str], username: &str, password: &str) -> Result<(), String> {
    let username = username.trim();
    let password = password.trim();
    if username.is_empty() && password.is_empty() {
        return Ok(());
    }
    if username.is_empty() {
        return Err("Network credentials: a password is set but the username is empty.".into());
    }
    let mut servers: Vec<String> = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if let Some(rest) = trimmed.strip_prefix("\\\\") {
            let end = rest.find(['\\', '/']).unwrap_or(rest.len());
            let server = format!("\\\\{}", &rest[..end]);
            if !servers.contains(&server) {
                servers.push(server);
            }
        }
    }
    for server in servers {
        connect_server(&server, password, username).map_err(|error| error)?;
    }
    Ok(())
}

#[cfg(windows)]
fn connect_server(server: &str, password: &str, username: &str) -> Result<(), String> {
    let output = std::process::Command::new("net")
        .args(["use", &format!("{server}\\IPC$"), password, &format!("/user:{username}"), "/persistent:no"])
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("Cannot run net use for {server}: {error}"))?;
    let message = net_message(&output);
    if output.status.success() {
        return Ok(());
    }
    // System error 1219: the server already has a session under a different user
    // name (e.g. the one Explorer opened via Win+R). That session serves the
    // file access, so reuse it instead of fighting over the credentials.
    if message_codes(&message).contains(&"1219") {
        return Ok(());
    }
    Err(friendly_logon_error(server, &message))
}

/// net.exe writes localized text in the system codepage - decode lossily and
/// keep only the ASCII part (the "System error <n>" number survives any locale).
#[cfg(windows)]
fn net_message(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text: String = format!("{stderr} {stdout}").chars().filter(|c| c.is_ascii()).collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The decimal error codes mentioned in a net.exe message ("System error 1219 ...").
#[cfg(windows)]
fn message_codes(message: &str) -> Vec<&str> {
    message
        .split(|c: char| !c.is_ascii_digit())
        .filter(|token| !token.is_empty())
        .collect()
}

#[cfg(windows)]
fn friendly_logon_error(server: &str, raw: &str) -> String {
    let codes = message_codes(raw);
    let reason = if codes.contains(&"1326") {
        "logon failure - wrong user name or password".to_string()
    } else if codes.contains(&"1219") {
        "the server already has a session under another user name".to_string()
    } else if codes.contains(&"53") {
        "the server was not found on the network".to_string()
    } else if codes.contains(&"67") {
        "the network share was not found".to_string()
    } else if codes.contains(&"5") {
        "access denied".to_string()
    } else if codes.contains(&"85") {
        "a connection is already established".to_string()
    } else if raw.is_empty() {
        "unknown error".to_string()
    } else {
        raw.to_string()
    };
    format!("Network logon for {server} failed: {reason} - check the network credentials in Machine Configuration.")
}

#[cfg(not(windows))]
pub fn ensure_unc_credentials(_paths: &[&str], _username: &str, _password: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn extracts_error_codes_from_localized_messages() {
        // Korean net.exe output ("System error 1219 has occurred...") survives as ASCII codes
        let output = std::process::Output { status: exit_failure(), stdout: "ýýýý 1219 ýýýýýýýýý.\r\n".into(), stderr: vec![] };
        let message = net_message(&output);
        assert!(message_codes(&message).contains(&"1219"), "{message}");
        assert!(!message.contains('ý'), "mojibake must be stripped: {message}");
    }

    #[test]
    fn friendly_messages_by_code() {
        assert!(friendly_logon_error("\\s", "System error 1326 has occurred").contains("wrong user name or password"));
        assert!(friendly_logon_error("\\s", "System error 53 has occurred").contains("not found on the network"));
        assert!(friendly_logon_error("\\s", "").contains("unknown error"));
        assert!(friendly_logon_error("\\s", "System error 1219 has occurred").contains("another user name"));
    }

    fn exit_failure() -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(1)
    }
}

//! The JSON-line wire format spoken with the sidecar process.
//!
//! Mirrors `sidecar/whatsapp/src/protocol.ts` exactly: one JSON object per
//! line, both directions. Rust writes [`Command`] lines to the child's stdin
//! and reads [`SidecarMessage`] lines from its stdout — an unsolicited
//! [`SidecarEvent`], or the [`SidecarMessage::Ack`] answering a command this
//! side sent by `id`. A change to one side without the other is a silent
//! protocol break, which is why the shapes here are pinned against literal
//! JSON rather than only against the TypeScript types.

use serde::{Deserialize, Serialize};

/// A command line written to the sidecar's stdin.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    Send {
        id: u64,
        to: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(rename = "imagePngBase64", skip_serializing_if = "Option::is_none")]
        image_png_base64: Option<String>,
    },
    Logout {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
    },
}

impl Command {
    /// The line to write, newline included — the sidecar reads with
    /// `readline`, which splits on it.
    pub fn to_line(&self) -> String {
        format!(
            "{}\n",
            serde_json::to_string(self).expect("Command always serialises")
        )
    }
}

/// One line read from the sidecar's stdout.
#[derive(Debug, Clone, PartialEq)]
pub enum SidecarMessage {
    Event(SidecarEvent),
    Ack { id: u64, result: Result<(), String> },
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum SidecarEvent {
    Qr { qr: String },
    Ready { number: String },
    Disconnected { reason: String },
    Error { message: String },
}

/// Parse one line of the sidecar's stdout.
///
/// `None` for a line that is neither a recognised event nor an ack — blank
/// output, or a shape a future sidecar version added that this build does not
/// know about — rather than failing the whole read loop over it. The sidecar
/// never writes anything else to stdout (see its own `protocol.ts`), so in
/// practice this only ever discards a blank trailing line.
pub fn parse_line(line: &str) -> Option<SidecarMessage> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;

    if value.get("event").is_some() {
        let event: SidecarEvent = serde_json::from_value(value).ok()?;
        return Some(SidecarMessage::Event(event));
    }

    let id = value.get("id")?.as_u64()?;
    let ok = value.get("ok")?.as_bool()?;
    let result = if ok {
        Ok(())
    } else {
        Err(value
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Perintah gagal tanpa keterangan.")
            .to_string())
    };
    Some(SidecarMessage::Ack { id, result })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_send_command_serialises_to_the_line_the_sidecar_expects() {
        let command = Command::Send {
            id: 7,
            to: "6281234567890".into(),
            text: Some("halo".into()),
            image_png_base64: None,
        };
        let value: serde_json::Value = serde_json::from_str(command.to_line().trim()).unwrap();
        assert_eq!(value["cmd"], "send");
        assert_eq!(value["id"], 7);
        assert_eq!(value["to"], "6281234567890");
        assert_eq!(value["text"], "halo");
        assert!(value.get("imagePngBase64").is_none());
        assert!(command.to_line().ends_with('\n'));
    }

    #[test]
    fn an_image_send_command_carries_the_base64_field_under_its_camel_case_name() {
        let command = Command::Send {
            id: 1,
            to: "6281234567890".into(),
            text: Some("caption".into()),
            image_png_base64: Some("aGVsbG8=".into()),
        };
        let value: serde_json::Value = serde_json::from_str(command.to_line().trim()).unwrap();
        assert_eq!(value["imagePngBase64"], "aGVsbG8=");
    }

    #[test]
    fn a_logout_command_with_no_id_omits_the_field() {
        let command = Command::Logout { id: None };
        let value: serde_json::Value = serde_json::from_str(command.to_line().trim()).unwrap();
        assert_eq!(value["cmd"], "logout");
        assert!(value.get("id").is_none());
    }

    #[test]
    fn a_qr_event_line_parses() {
        let msg = parse_line(r#"{"event":"qr","qr":"2@abc"}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Event(SidecarEvent::Qr { qr: "2@abc".into() })
        );
    }

    #[test]
    fn a_ready_event_line_parses() {
        let msg = parse_line(r#"{"event":"ready","number":"6281234567890"}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Event(SidecarEvent::Ready {
                number: "6281234567890".into()
            })
        );
    }

    #[test]
    fn a_disconnected_event_line_parses() {
        let msg = parse_line(r#"{"event":"disconnected","reason":"LOGOUT"}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Event(SidecarEvent::Disconnected {
                reason: "LOGOUT".into()
            })
        );
    }

    #[test]
    fn an_error_event_line_parses() {
        let msg = parse_line(r#"{"event":"error","message":"boom"}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Event(SidecarEvent::Error {
                message: "boom".into()
            })
        );
    }

    #[test]
    fn a_successful_ack_parses() {
        let msg = parse_line(r#"{"id":3,"ok":true}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Ack {
                id: 3,
                result: Ok(())
            }
        );
    }

    #[test]
    fn a_failed_ack_carries_its_error() {
        let msg =
            parse_line(r#"{"id":3,"ok":false,"error":"Nomor tidak valid."}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Ack {
                id: 3,
                result: Err("Nomor tidak valid.".into())
            }
        );
    }

    #[test]
    fn a_failed_ack_without_an_error_field_still_parses() {
        let msg = parse_line(r#"{"id":3,"ok":false}"#).expect("parses");
        assert_eq!(
            msg,
            SidecarMessage::Ack {
                id: 3,
                result: Err("Perintah gagal tanpa keterangan.".into())
            }
        );
    }

    #[test]
    fn a_blank_line_is_ignored() {
        assert_eq!(parse_line(""), None);
        assert_eq!(parse_line("   \n"), None);
    }

    #[test]
    fn garbage_input_is_ignored_rather_than_panicking() {
        assert_eq!(parse_line("not json"), None);
        assert_eq!(parse_line("{}"), None);
        assert_eq!(parse_line("[1,2,3]"), None);
    }
}

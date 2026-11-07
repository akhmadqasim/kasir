//! Bluetooth receipt printers on Linux: paired devices that offer the Serial
//! Port Profile, reached through BlueZ.
//!
//! The RFCOMM channel is not guessed. A client SPP profile is registered with
//! BlueZ and the device's profile is connected: BlueZ looks the channel up over
//! SDP, connects, and hands the socket to the profile. Pairing itself stays in
//! the system's Bluetooth settings.

use std::future::Future;
use std::os::fd::AsRawFd;
use std::sync::OnceLock;
use std::time::Duration;

use bluer::rfcomm::{Profile, ProfileHandle, Role, Socket};
use bluer::{Adapter, Address, Session, Uuid};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::{PrinterInfo, PrinterKind};
use crate::utils::logging::log_error;

/// Prefix that marks a printer id as a Bluetooth address.
pub const ID_PREFIX: &str = "bt:";

/// Serial Port Profile, the profile receipt printers print over.
const SERIAL_PORT: Uuid = Uuid::from_u128(0x0000_1101_0000_1000_8000_0080_5F9B_34FB);

/// One whole job: connecting (a switched-off printer makes BlueZ wait out its
/// page timeout), sending and draining.
const JOB_TIMEOUT: Duration = Duration::from_secs(60);
/// A stuck bluetoothd must not hang the printer list (and settings with it).
const LIST_TIMEOUT: Duration = Duration::from_secs(5);
/// How often to look whether the socket has sent everything.
const DRAIN_POLL: Duration = Duration::from_millis(50);

const CONNECT_FAILED: &str = "Gagal menyambung ke printer Bluetooth. Pastikan printer menyala, \
     sudah dipasangkan, dan Bluetooth komputer ini aktif.";
const SEND_FAILED: &str = "Gagal mengirim data ke printer Bluetooth. Coba cetak ulang.";
const NOT_ANSWERING: &str = "Printer Bluetooth tidak menjawab. Pastikan printer menyala dan dekat.";

/// Paired SPP devices. A PC without Bluetooth, or with the daemon stopped, has
/// none: that is an empty list, not an error, so USB printers still show.
pub fn list_printers() -> Vec<PrinterInfo> {
    match block_on(tokio::time::timeout(LIST_TIMEOUT, paired_printers())) {
        Ok(Ok(printers)) => printers,
        Ok(Err(_)) => Vec::new(),
        Err(_) => {
            log_error("Bluetooth printer list timed out");
            Vec::new()
        }
    }
}

/// Write raw bytes to the printer with this id (`bt:` + address). The caller
/// runs one job at a time (`linux_printer`).
pub fn send_raw_data(printer_id: &str, data: &[u8]) -> Result<(), String> {
    let address: Address = printer_id
        .strip_prefix(ID_PREFIX)
        .and_then(|address| address.parse().ok())
        .ok_or_else(|| super::UNKNOWN_PRINTER.to_string())?;
    block_on(print(address, data))
}

/// Run a BlueZ call from the blocking thread a print or list job runs on
/// (`spawn_blocking`). Never call it from async code: `Handle::block_on`
/// panics there.
fn block_on<T>(future: impl Future<Output = T>) -> T {
    tokio::runtime::Handle::current().block_on(future)
}

async fn paired_printers() -> bluer::Result<Vec<PrinterInfo>> {
    let session = Session::new().await?;
    let adapter = session.default_adapter().await?;

    let mut printers = Vec::new();
    for address in adapter.device_addresses().await? {
        match spp_device_name(&adapter, address).await {
            Ok(Some(name)) => printers.push(PrinterInfo {
                id: format!("{ID_PREFIX}{address}"),
                name: format!("{name} (Bluetooth)"),
                kind: PrinterKind::Bluetooth,
                is_default: false,
            }),
            Ok(None) => {}
            // A device can go away mid-scan; it is just not listed.
            Err(error) => log_error(&format!("Bluetooth device {address} skipped: {error}")),
        }
    }
    Ok(printers)
}

/// The device's alias when it is paired and offers SPP, otherwise `None`: a
/// paired phone or headset is not a printer.
async fn spp_device_name(adapter: &Adapter, address: Address) -> bluer::Result<Option<String>> {
    let device = adapter.device(address)?;
    if !device.is_paired().await? {
        return Ok(None);
    }
    let offers_spp = device
        .uuids()
        .await?
        .is_some_and(|uuids| uuids.contains(&SERIAL_PORT));
    Ok(if offers_spp {
        Some(device.alias().await?)
    } else {
        None
    })
}

/// The BlueZ session and the client SPP profile, kept between jobs. A profile
/// registered per job raced its own removal: BlueZ could hand the next job's
/// connection to the registration that was still going away.
struct Link {
    /// Owns the D-Bus connection the profile is served on.
    _session: Session,
    adapter: Adapter,
    profile: ProfileHandle,
}

fn kept_link() -> &'static Mutex<Option<Link>> {
    static LINK: OnceLock<Mutex<Option<Link>>> = OnceLock::new();
    LINK.get_or_init(|| Mutex::new(None))
}

/// Print over the kept link, opening it first if needed. A failed or timed-out
/// job drops the link, so the next one starts clean (bluetoothd may have been
/// restarted, or a late connection may still be queued on the old profile).
async fn print(address: Address, data: &[u8]) -> Result<(), String> {
    let mut guard = kept_link().lock().await;
    let slot: &mut Option<Link> = &mut guard;
    let job = async {
        if slot.is_none() {
            *slot = Some(Link::open().await.map_err(|e| failure(CONNECT_FAILED, e))?);
        }
        let Some(link) = slot.as_mut() else {
            return Err(CONNECT_FAILED.to_string());
        };
        link.print(address, data).await
    };
    let result = tokio::time::timeout(JOB_TIMEOUT, job)
        .await
        .unwrap_or_else(|_| Err(NOT_ANSWERING.to_string()));
    if result.is_err() {
        *slot = None;
    }
    result
}

impl Link {
    async fn open() -> bluer::Result<Self> {
        let session = Session::new().await?;
        let adapter = session.default_adapter().await?;
        let profile = session
            .register_profile(Profile {
                uuid: SERIAL_PORT,
                role: Some(Role::Client),
                require_authentication: Some(false),
                require_authorization: Some(false),
                auto_connect: Some(false),
                ..Default::default()
            })
            .await?;
        Ok(Self {
            _session: session,
            adapter,
            profile,
        })
    }

    /// Connect the device's SPP, send `data`, wait until the socket has sent it
    /// all, and disconnect.
    async fn print(&mut self, address: Address, data: &[u8]) -> Result<(), String> {
        let device = self
            .adapter
            .device(address)
            .map_err(|e| failure(CONNECT_FAILED, e))?;
        let profile = &mut self.profile;
        // A link an earlier job left up would make BlueZ answer the connect
        // without handing over a new socket. Not connected is the normal case,
        // and its error says nothing worth reporting.
        let _ = device.disconnect_profile(&SERIAL_PORT).await;

        // BlueZ answers `connect_profile` only after the profile took the
        // socket, so the two run together. A connection for another device
        // (one that arrived late for an earlier job) is turned away.
        let accepting = async {
            loop {
                let request = profile
                    .next()
                    .await
                    .ok_or_else(|| CONNECT_FAILED.to_string())?;
                if request.device() == address {
                    return request.accept().map_err(|e| failure(CONNECT_FAILED, e));
                }
            }
        };
        let connecting = async {
            device
                .connect_profile(&SERIAL_PORT)
                .await
                .map_err(|e| failure(CONNECT_FAILED, e))
        };
        let ((), mut stream) = tokio::try_join!(connecting, accepting)?;

        stream
            .write_all(data)
            .await
            .map_err(|e| failure(SEND_FAILED, e))?;
        drained(stream.as_ref())
            .await
            .map_err(|e| failure(SEND_FAILED, e))?;
        // A link that dropped mid-drain also empties the buffer, by discarding
        // it: only a still-connected socket means the data went out.
        stream.peer_addr().map_err(|e| failure(SEND_FAILED, e))?;
        drop(stream);

        // bluetoothd keeps its own copy of the socket, so the link stays up
        // until the profile is disconnected. The receipt is out either way.
        if let Err(error) = device.disconnect_profile(&SERIAL_PORT).await {
            log_error(&format!(
                "Bluetooth printer {address} not disconnected: {error}"
            ));
        }
        Ok(())
    }
}

/// Wait until the socket has handed every byte on: closing it throws away
/// whatever it still holds. On Bluetooth sockets `TIOCOUTQ` (`output_buffer`)
/// reports the FREE space of the send buffer, so the buffer is empty once that
/// equals its full size.
async fn drained(socket: &Socket) -> std::io::Result<()> {
    let capacity = send_buffer_size(socket)?;
    while socket.output_buffer()? < capacity {
        tokio::time::sleep(DRAIN_POLL).await;
    }
    Ok(())
}

/// `SO_SNDBUF` of the socket, in bytes.
fn send_buffer_size(socket: &Socket) -> std::io::Result<u32> {
    let mut size: libc::c_int = 0;
    let mut length = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `size` and `length` are valid for writes of the sizes given.
    let status = unsafe {
        libc::getsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_SNDBUF,
            std::ptr::from_mut(&mut size).cast(),
            &mut length,
        )
    };
    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }
    u32::try_from(size).map_err(|_| std::io::ErrorKind::InvalidData.into())
}

/// The cashier gets `message`; the log gets what BlueZ or the kernel said.
fn failure(message: &str, error: impl std::fmt::Display) -> String {
    log_error(&format!("Bluetooth printer: {error}"));
    message.to_string()
}

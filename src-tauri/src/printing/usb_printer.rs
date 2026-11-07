//! USB receipt printers off Windows, with no driver at all: the kernel's
//! `usblp` gives every USB Printer Class device a `/dev/usb/lpN` node, and the
//! ESC/POS bytes are written straight to it. Reverse engineering the store's
//! printer driver (POS58ENG for the TECH CLA58) found nothing beyond one-way
//! ESC/POS writes, so nothing more is needed.
//!
//! The deb and rpm packages install a udev rule that gives the logged-in user
//! access to those nodes (`src-tauri/linux/70-kasir-printer.rules`).

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::{PrinterInfo, PrinterKind};

/// Where the kernel lists `usblp` devices, and where their nodes live.
const CLASS_DIR: &str = "/sys/class/usbmisc";
const NODE_DIR: &str = "/dev/usb";

/// How long the printer may go without taking data. `usblp` holds a write for
/// as long as the paper is out or the cover is open; past this the cashier is
/// told instead of the till waiting forever. It restarts after every transfer,
/// so a long receipt that keeps printing never runs into it.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// Every USB printer plugged in now. None plugged in is an empty list:
/// `CLASS_DIR` only exists once `usblp` has seen a device.
pub fn list_printers() -> Vec<PrinterInfo> {
    usb_printers(Path::new(CLASS_DIR))
        .into_iter()
        .map(|printer| PrinterInfo {
            id: printer.id,
            name: printer.name,
            kind: PrinterKind::Usb,
            is_default: false,
        })
        .collect()
}

/// Write raw bytes to the printer with this id.
pub fn send_raw_data(printer_id: &str, data: &[u8]) -> Result<(), String> {
    let printer = find_printer(usb_printers(Path::new(CLASS_DIR)), printer_id)
        .ok_or_else(|| "Printer USB tidak tersambung. Colok printer lalu coba lagi.".to_string())?;

    // Non-blocking, so a printer that stops taking data cannot hold the job
    // past its deadline.
    let port = OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&printer.node)
        .map_err(|error| open_error(&printer.name, &error))?;
    write_all(&port, data, IDLE_TIMEOUT).map_err(|error| write_error(&error))
}

/// The printer with this id. One without a serial number carries its port in
/// its id, so after its cable moved to another port it is still found, as long
/// as it is the only plugged-in printer of that model.
fn find_printer(printers: Vec<UsbPrinter>, id: &str) -> Option<UsbPrinter> {
    if let Some(index) = printers.iter().position(|printer| printer.id == id) {
        return printers.into_iter().nth(index);
    }
    let model = serial_less_model(id)?;
    let mut same_model = printers
        .into_iter()
        .filter(|printer| serial_less_model(&printer.id) == Some(model));
    match (same_model.next(), same_model.next()) {
        (Some(printer), None) => Some(printer),
        _ => None,
    }
}

/// `VID:PID` of a `VID:PID@port` id.
fn serial_less_model(id: &str) -> Option<&str> {
    id.split_once('@').map(|(model, _)| model)
}

/// Write all of `data`, giving up when the port takes nothing for `idle`, then
/// wait until `usblp` has handed the last of it to the printer: closing the
/// node cancels a transfer still in flight.
fn write_all<P>(port: &P, mut data: &[u8], idle: Duration) -> io::Result<()>
where
    P: AsRawFd,
    for<'a> &'a P: Write,
{
    let mut writer = port;
    let mut deadline = Instant::now() + idle;
    while !data.is_empty() {
        match writer.write(data) {
            Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
            Ok(written) => {
                data = &data[written..];
                deadline = Instant::now() + idle;
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_writable(port, deadline)?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    wait_writable(port, deadline)
}

/// Wait until the node takes data again, meaning its last transfer finished.
fn wait_writable(port: &impl AsRawFd, deadline: Instant) -> io::Result<()> {
    let mut request = libc::pollfd {
        fd: port.as_raw_fd(),
        events: libc::POLLOUT,
        revents: 0,
    };
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let timeout_ms = i32::try_from(left.as_millis()).unwrap_or(i32::MAX);
        // SAFETY: one valid `pollfd`, for a descriptor `port` keeps open.
        match unsafe { libc::poll(&mut request, 1, timeout_ms) } {
            0 => return Err(io::ErrorKind::TimedOut.into()),
            -1 => {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
            _ if request.revents & (libc::POLLERR | libc::POLLHUP) != 0 => {
                return Err(io::ErrorKind::BrokenPipe.into());
            }
            _ => return Ok(()),
        }
    }
}

fn write_error(error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::TimedOut {
        "Printer tidak menerima data. Cek kertas dan tutup printer, lalu cetak ulang.".to_string()
    } else if error.kind() == io::ErrorKind::BrokenPipe
        || error.raw_os_error() == Some(libc::ENODEV)
    {
        "Printer USB terputus saat mencetak.".to_string()
    } else {
        format!("Gagal mengirim data ke printer: {error}")
    }
}

fn open_error(name: &str, error: &io::Error) -> String {
    if error.raw_os_error() == Some(libc::EBUSY) {
        format!(
            "Printer {name} sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu cetak ulang."
        )
    } else if error.raw_os_error() == Some(libc::ENODEV) || error.kind() == io::ErrorKind::NotFound
    {
        "Printer USB tidak tersambung. Colok printer lalu coba lagi.".to_string()
    } else if error.kind() == io::ErrorKind::PermissionDenied {
        format!(
            "Kasir belum punya izin ke printer {name}. Pasang kasir dari paket .deb atau .rpm. \
             Untuk AppImage, jalankan sekali `sudo usermod -aG lp $USER` lalu login ulang."
        )
    } else {
        format!("Gagal membuka printer {name}: {error}")
    }
}

/// One `usblp` device.
#[derive(Debug, PartialEq)]
struct UsbPrinter {
    /// `VID:PID/serial`, stable across replugging and ports; or `VID:PID@port`
    /// for a printer that reports no serial number (see [`find_printer`]).
    id: String,
    name: String,
    node: PathBuf,
}

/// The printers `class_dir` lists, sorted by name. A device whose attributes
/// cannot be read (unplugged mid-scan) is skipped.
fn usb_printers(class_dir: &Path) -> Vec<UsbPrinter> {
    let Ok(entries) = fs::read_dir(class_dir) else {
        return Vec::new();
    };
    let mut printers: Vec<UsbPrinter> = entries
        .flatten()
        .filter_map(|entry| {
            let node = entry.file_name().into_string().ok()?;
            node.starts_with("lp")
                .then(|| UsbPrinter::from_sysfs(&entry.path(), &node))
                .flatten()
        })
        .collect();
    printers.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    printers
}

impl UsbPrinter {
    /// Read one class entry (`lpN`). Its `device` link points at the USB
    /// interface; the USB device with the descriptor strings is the parent.
    fn from_sysfs(class_entry: &Path, node: &str) -> Option<Self> {
        let interface = fs::canonicalize(class_entry.join("device")).ok()?;
        let device = interface.parent()?;
        let vendor = attribute(device, "idVendor")?;
        let product_id = attribute(device, "idProduct")?;

        let id = match attribute(device, "serial") {
            Some(serial) => format!("{vendor}:{product_id}/{serial}"),
            None => format!(
                "{vendor}:{product_id}@{}",
                device.file_name()?.to_string_lossy()
            ),
        };
        let label = [
            attribute(device, "manufacturer"),
            attribute(device, "product"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        let name = if label.is_empty() {
            format!("Printer USB {vendor}:{product_id}")
        } else {
            label
        };

        Some(Self {
            id,
            name,
            node: Path::new(NODE_DIR).join(node),
        })
    }
}

/// A sysfs attribute, trimmed; `None` when missing or blank.
fn attribute(dir: &Path, name: &str) -> Option<String> {
    let value = fs::read_to_string(dir.join(name)).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::os::unix::fs::symlink;
    use std::os::unix::net::UnixStream;

    /// A fake sysfs tree under the temp dir, removed on drop.
    struct Sysfs {
        root: PathBuf,
    }

    impl Sysfs {
        fn new(test: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("kasir-usb-{test}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("class")).unwrap();
            fs::create_dir_all(root.join("devices")).unwrap();
            Self { root }
        }

        fn class(&self) -> PathBuf {
            self.root.join("class")
        }

        /// `devices/<dir>` with the given attributes (newline-terminated, like the
        /// kernel) and its `<dir>:1.0` interface.
        fn device(&self, dir: &str, attributes: &[(&str, &str)]) {
            let device = self.root.join("devices").join(dir);
            fs::create_dir_all(device.join(format!("{dir}:1.0"))).unwrap();
            for (name, value) in attributes {
                fs::write(device.join(name), format!("{value}\n")).unwrap();
            }
        }

        /// `class/<lp>/device -> devices/<dir>/<dir>:1.0`.
        fn plug(&self, lp: &str, dir: &str) {
            let entry = self.class().join(lp);
            fs::create_dir_all(&entry).unwrap();
            let interface = self
                .root
                .join("devices")
                .join(dir)
                .join(format!("{dir}:1.0"));
            symlink(interface, entry.join("device")).unwrap();
        }
    }

    impl Drop for Sysfs {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    const EPSON: &[(&str, &str)] = &[
        ("idVendor", "04b8"),
        ("idProduct", "0e15"),
        ("manufacturer", "EPSON"),
        ("product", "TM-T20II"),
        ("serial", "ABC123"),
    ];

    fn printer(id: &str) -> UsbPrinter {
        UsbPrinter {
            id: id.to_string(),
            name: "Printer".to_string(),
            node: PathBuf::from(format!("/dev/usb/{id}")),
        }
    }

    fn nonblocking_pair() -> (UnixStream, UnixStream) {
        let (writer, reader) = UnixStream::pair().unwrap();
        writer.set_nonblocking(true).unwrap();
        (writer, reader)
    }

    #[test]
    fn missing_or_empty_class_dir_gives_an_empty_list() {
        let sysfs = Sysfs::new("no_printers");
        assert!(usb_printers(&sysfs.root.join("nope")).is_empty());
        assert!(usb_printers(&sysfs.class()).is_empty());
    }

    #[test]
    fn only_lp_entries_are_listed_with_their_dev_usb_node() {
        let sysfs = Sysfs::new("lp_only");
        sysfs.device("1-6", EPSON);
        sysfs.plug("hiddev0", "1-6");
        sysfs.plug("lp7", "1-6");
        let printers = usb_printers(&sysfs.class());
        assert_eq!(printers.len(), 1);
        assert_eq!(printers[0].node, Path::new("/dev/usb/lp7"));
    }

    #[test]
    fn id_is_vendor_product_and_trimmed_serial_when_there_is_a_serial() {
        let sysfs = Sysfs::new("id_serial");
        sysfs.device(
            "1-6",
            &[
                ("idVendor", "04b8"),
                ("idProduct", "0e15"),
                ("serial", " ABC123 "),
            ],
        );
        sysfs.plug("lp0", "1-6");
        assert_eq!(usb_printers(&sysfs.class())[0].id, "04b8:0e15/ABC123");
    }

    #[test]
    fn id_uses_the_device_dir_name_when_there_is_no_serial() {
        let sysfs = Sysfs::new("id_no_serial");
        sysfs.device("1-6", &[("idVendor", "0416"), ("idProduct", "5011")]);
        sysfs.plug("lp0", "1-6");
        assert_eq!(usb_printers(&sysfs.class())[0].id, "0416:5011@1-6");
    }

    #[test]
    fn name_joins_manufacturer_and_product() {
        let sysfs = Sysfs::new("name_both");
        sysfs.device("1-6", EPSON);
        sysfs.plug("lp0", "1-6");
        assert_eq!(usb_printers(&sysfs.class())[0].name, "EPSON TM-T20II");
    }

    #[test]
    fn name_is_just_the_product_when_the_manufacturer_is_blank() {
        let sysfs = Sysfs::new("name_product_only");
        sysfs.device(
            "1-6",
            &[
                ("idVendor", "04b8"),
                ("idProduct", "0e15"),
                ("manufacturer", "  "),
                ("product", "TM-T20II"),
            ],
        );
        sysfs.plug("lp0", "1-6");
        assert_eq!(usb_printers(&sysfs.class())[0].name, "TM-T20II");
    }

    #[test]
    fn name_falls_back_to_vendor_and_product_ids_when_both_are_missing() {
        let sysfs = Sysfs::new("name_fallback");
        sysfs.device("1-6", &[("idVendor", "04b8"), ("idProduct", "0e15")]);
        sysfs.plug("lp0", "1-6");
        assert_eq!(
            usb_printers(&sysfs.class())[0].name,
            "Printer USB 04b8:0e15"
        );
    }

    #[test]
    fn device_missing_a_vendor_or_product_id_is_skipped() {
        let sysfs = Sysfs::new("missing_ids");
        sysfs.device("1-1", &[("idProduct", "0e15")]);
        sysfs.device("1-2", &[("idVendor", "04b8")]);
        sysfs.device("1-3", EPSON);
        sysfs.plug("lp0", "1-1");
        sysfs.plug("lp1", "1-2");
        sysfs.plug("lp2", "1-3");
        let printers = usb_printers(&sysfs.class());
        assert_eq!(printers.len(), 1);
        assert_eq!(printers[0].node, Path::new("/dev/usb/lp2"));
    }

    #[test]
    fn entry_with_a_dangling_device_link_is_skipped() {
        let sysfs = Sysfs::new("dangling");
        let entry = sysfs.class().join("lp0");
        fs::create_dir_all(&entry).unwrap();
        symlink(sysfs.root.join("devices/gone"), entry.join("device")).unwrap();
        assert!(usb_printers(&sysfs.class()).is_empty());
    }

    #[test]
    fn printers_are_sorted_by_name_then_id() {
        let sysfs = Sysfs::new("sorted");
        let ids = [("idVendor", "0416"), ("idProduct", "5011")];
        let with = |product, serial: Option<&'static str>| {
            let mut attributes = ids.to_vec();
            attributes.push(("product", product));
            attributes.extend(serial.map(|serial| ("serial", serial)));
            attributes
        };
        sysfs.device("1-1", &with("Zebra", None));
        sysfs.device("1-2", &with("Alpha", None));
        sysfs.device("1-3", &with("Alpha", Some("A")));
        sysfs.plug("lp0", "1-1");
        sysfs.plug("lp1", "1-2");
        sysfs.plug("lp2", "1-3");
        let listed: Vec<String> = usb_printers(&sysfs.class())
            .into_iter()
            .map(|printer| printer.id)
            .collect();
        // Same name "Alpha": '/' sorts before '@'.
        assert_eq!(listed, ["0416:5011/A", "0416:5011@1-2", "0416:5011@1-1"]);
    }

    #[test]
    fn attribute_is_trimmed_and_none_when_missing_or_blank() {
        let sysfs = Sysfs::new("attribute");
        sysfs.device("1-6", &[("blank", "  "), ("value", " x ")]);
        let dir = sysfs.root.join("devices/1-6");
        assert_eq!(attribute(&dir, "absent"), None);
        assert_eq!(attribute(&dir, "blank"), None);
        assert_eq!(attribute(&dir, "value"), Some("x".to_string()));
    }

    #[test]
    fn exact_id_wins_over_a_same_model_printer_on_another_port() {
        let printers = vec![printer("0416:5011@1-1"), printer("0416:5011@1-2")];
        let found = find_printer(printers, "0416:5011@1-2").unwrap();
        assert_eq!(found.id, "0416:5011@1-2");
    }

    #[test]
    fn serial_less_id_finds_the_only_printer_of_that_model_on_another_port() {
        let printers = vec![printer("04b8:0e15/ABC"), printer("0416:5011@2-3")];
        let found = find_printer(printers, "0416:5011@1-6").unwrap();
        assert_eq!(found.id, "0416:5011@2-3");
    }

    #[test]
    fn serial_less_id_finds_nothing_when_two_printers_share_the_model() {
        let printers = vec![printer("0416:5011@2-3"), printer("0416:5011@2-4")];
        assert_eq!(find_printer(printers, "0416:5011@1-6"), None);
    }

    #[test]
    fn serial_id_never_falls_back_to_another_printer() {
        let printers = vec![printer("0416:5011/OTHER"), printer("0416:5011@1-6")];
        assert_eq!(find_printer(printers, "0416:5011/MINE"), None);
    }

    #[test]
    fn write_all_delivers_all_data_even_when_the_buffer_fills_up() {
        let (writer, mut reader) = nonblocking_pair();
        let data: Vec<u8> = (0..2_000_000u32).map(|i| (i % 251) as u8).collect();
        let expected = data.clone();
        let consumer = std::thread::spawn(move || {
            let mut received = vec![0; expected.len()];
            reader.read_exact(&mut received).unwrap();
            received == expected
        });
        write_all(&writer, &data, Duration::from_secs(10)).unwrap();
        assert!(consumer.join().unwrap());
    }

    #[test]
    fn write_all_times_out_when_nobody_reads_and_the_buffer_is_full() {
        let (writer, _reader) = nonblocking_pair();
        let data = vec![0u8; 8_000_000];
        let error = write_all(&writer, &data, Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn write_error_maps_timeout_and_disconnect_to_indonesian_messages() {
        let timed_out = write_error(&io::ErrorKind::TimedOut.into());
        let broken = write_error(&io::ErrorKind::BrokenPipe.into());
        assert!(timed_out.starts_with("Printer tidak menerima data"));
        assert_eq!(broken, "Printer USB terputus saat mencetak.");
    }

    #[test]
    fn open_error_hints_at_the_udev_package_when_permission_is_denied() {
        let message = open_error("EPSON", &io::ErrorKind::PermissionDenied.into());
        assert!(message.contains(".deb"));
    }
}

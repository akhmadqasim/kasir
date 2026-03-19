/// Direct USB printer communication using rusb (libusb)
/// Sends raw ESC/POS bytes directly to USB thermal printers without Windows driver

use rusb::{Context, UsbContext};

#[derive(Debug, Clone, serde::Serialize)]
pub struct UsbPrinterInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub name: String,
    pub id: String, // "vid:pid" format for selection
}

/// List USB devices that have a printer-class interface (class 7)
pub fn list_usb_printers() -> Result<Vec<UsbPrinterInfo>, String> {
    let context = Context::new().map_err(|e| format!("USB init error: {}", e))?;
    let devices = context
        .devices()
        .map_err(|e| format!("USB device list error: {}", e))?;

    let mut printers = Vec::new();

    for device in devices.iter() {
        let desc = match device.device_descriptor() {
            Ok(d) => d,
            Err(_) => continue,
        };

        let config = match device.active_config_descriptor() {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Check if any interface has class 7 (Printer)
        let is_printer = config.interfaces().any(|iface| {
            iface
                .descriptors()
                .any(|setting| setting.class_code() == 7)
        });

        if !is_printer {
            continue;
        }

        let handle = device.open().ok();
        let name = handle
            .as_ref()
            .and_then(|h| h.read_product_string_ascii(&desc).ok())
            .unwrap_or_else(|| {
                format!("USB Printer {:04X}:{:04X}", desc.vendor_id(), desc.product_id())
            });

        printers.push(UsbPrinterInfo {
            vendor_id: desc.vendor_id(),
            product_id: desc.product_id(),
            name,
            id: format!("{:04X}:{:04X}", desc.vendor_id(), desc.product_id()),
        });
    }

    Ok(printers)
}

/// Send raw bytes to a USB printer identified by vendor_id:product_id
pub fn send_raw_data(vendor_id: u16, product_id: u16, data: &[u8]) -> Result<(), String> {
    let context = Context::new().map_err(|e| format!("USB init error: {}", e))?;
    let devices = context
        .devices()
        .map_err(|e| format!("USB device list error: {}", e))?;

    for device in devices.iter() {
        let desc = match device.device_descriptor() {
            Ok(d) => d,
            Err(_) => continue,
        };

        if desc.vendor_id() != vendor_id || desc.product_id() != product_id {
            continue;
        }

        let handle = device
            .open()
            .map_err(|e| format!("Gagal membuka USB device: {}", e))?;

        // Find the printer interface and OUT endpoint
        let config = device
            .active_config_descriptor()
            .map_err(|e| format!("Gagal baca config USB: {}", e))?;

        let mut iface_num = 0u8;
        let mut endpoint_addr = 0u8;
        let mut found = false;

        for iface in config.interfaces() {
            for setting in iface.descriptors() {
                if setting.class_code() != 7 {
                    continue;
                }
                iface_num = setting.interface_number();

                // Find bulk OUT endpoint
                for ep in setting.endpoint_descriptors() {
                    if ep.transfer_type() == rusb::TransferType::Bulk
                        && ep.direction() == rusb::Direction::Out
                    {
                        endpoint_addr = ep.address();
                        found = true;
                        break;
                    }
                }
                if found {
                    break;
                }
            }
            if found {
                break;
            }
        }

        if !found {
            return Err("Tidak ditemukan endpoint printer pada USB device".to_string());
        }

        // Detach kernel driver if needed (Linux/Mac)
        #[cfg(not(windows))]
        {
            if handle.kernel_driver_active(iface_num).unwrap_or(false) {
                handle
                    .detach_kernel_driver(iface_num)
                    .map_err(|e| format!("Gagal detach kernel driver: {}", e))?;
            }
        }

        handle
            .claim_interface(iface_num)
            .map_err(|e| format!("Gagal claim USB interface: {}", e))?;

        // Send data in chunks (max 4096 bytes per transfer)
        let chunk_size = 4096;
        for chunk in data.chunks(chunk_size) {
            handle
                .write_bulk(endpoint_addr, chunk, std::time::Duration::from_secs(5))
                .map_err(|e| format!("Gagal mengirim data ke printer: {}", e))?;
        }

        handle
            .release_interface(iface_num)
            .map_err(|e| format!("Gagal release USB interface: {}", e))?;

        return Ok(());
    }

    Err(format!(
        "USB printer {:04X}:{:04X} tidak ditemukan",
        vendor_id, product_id
    ))
}

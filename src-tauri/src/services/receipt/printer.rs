//! Sending formatted lines to the configured printer.

use sea_orm::DatabaseConnection;

use super::settings::{get_printer_settings, receipt_render_settings, ReceiptRenderSettings};
use crate::domain::receipt::PrinterInfoItem;
use crate::entity::store_info;
use crate::printing::receipt::{format_test_page_text, PrintMode, ReceiptTextLine};
use crate::utils::AppError;

/// Encode the lines and send them to the print queue as RAW data.
///
/// In raster mode the text is drawn with GDI and the picture is sent, which is
/// how the Mitra Indogrosir app prints and what the shop asked us to match; in
/// text mode the characters go to the printer's own font engine, which is
/// faster and much smaller but looks like three fonts on one slip.
fn send_to_printer(
    printer_id: &str,
    lines: &[ReceiptTextLine],
    paper_width: u8,
    mode: PrintMode,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use crate::printing::layout::columns;
        use crate::printing::raster::{render_lines, DOTS_58MM, DOTS_80MM};

        let bytes = match mode {
            PrintMode::Raster => {
                let dots = if paper_width >= 80 {
                    DOTS_80MM
                } else {
                    DOTS_58MM
                };
                let bitmap = render_lines(lines, columns(paper_width), dots)?;
                crate::printing::escpos::encode_raster(&bitmap)
            }
            PrintMode::Text => crate::printing::escpos::encode_lines(lines),
        };
        crate::printing::windows_printer::send_raw_data(printer_id, &bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = (printer_id, lines, paper_width, mode);
        Err("Printing hanya tersedia di Windows".to_string())
    }
}

/// Where a print job goes and how the paper is set up. Every print path needs
/// the same four things and all of them come from the single `store_info` row,
/// so they are fetched once, here.
pub(super) struct PrintTarget {
    pub(super) store: store_info::Model,
    pub(super) printer_id: String,
    pub(super) paper_width: u8,
    pub(super) footer_text: Option<String>,
    pub(super) mode: PrintMode,
}

pub(super) async fn print_target(db: &DatabaseConnection) -> Result<PrintTarget, AppError> {
    let ReceiptRenderSettings {
        store,
        paper_width,
        footer_text,
    } = receipt_render_settings(db).await?;

    let settings = get_printer_settings(&store.additional_info);
    let printer_id = settings
        .printer_id
        .ok_or_else(|| AppError::Validation("Printer belum dikonfigurasi".into()))?;

    Ok(PrintTarget {
        store,
        printer_id,
        paper_width,
        footer_text,
        mode: PrintMode::from_setting(settings.print_mode.as_deref()),
    })
}

/// Send already-formatted jobs to the printer, in order, off the async runtime.
///
/// One job per piece of paper. A PPOB struk is cut away from the sale receipt
/// it belongs to precisely so the customer can take it to PLN without carrying
/// the shop's own receipt with it.
///
/// A job that fails does not cancel the ones behind it. The jobs are separate
/// pieces of paper for separate purposes, and stopping after the first failure
/// would mean one unlucky struk also costs the customer the second one.
pub(super) async fn send_jobs(
    printer_id: String,
    jobs: Vec<Vec<ReceiptTextLine>>,
    paper_width: u8,
    mode: PrintMode,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let mut first_error = None;
        for job in &jobs {
            if let Err(error) = send_to_printer(&printer_id, job, paper_width, mode) {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("Print task error: {}", e)))?
    .map_err(AppError::Internal)
}

pub async fn list_printers() -> Result<Vec<PrinterInfoItem>, AppError> {
    tokio::task::spawn_blocking(|| {
        let mut all_printers = Vec::new();

        // A failed enumeration (spooler stopped, say) is an error the screen
        // should show, not an empty list that reads as "no printers here".
        #[cfg(windows)]
        {
            for p in crate::printing::windows_printer::list_printers()? {
                all_printers.push(PrinterInfoItem {
                    id: p.name.clone(),
                    name: if p.is_default {
                        format!("{} (Default)", p.name)
                    } else {
                        p.name
                    },
                    printer_type: "windows".to_string(),
                    is_default: p.is_default,
                });
            }
        }

        Ok::<_, String>(all_printers)
    })
    .await
    .map_err(|e| AppError::Internal(format!("List printers error: {}", e)))?
    .map_err(AppError::Internal)
}

pub async fn test_print(db: &DatabaseConnection) -> Result<(), AppError> {
    let PrintTarget {
        store,
        printer_id,
        paper_width,
        mode,
        ..
    } = print_target(db).await?;

    let text_lines = format_test_page_text(&store.name, paper_width);

    send_jobs(printer_id, vec![text_lines], paper_width, mode).await
}

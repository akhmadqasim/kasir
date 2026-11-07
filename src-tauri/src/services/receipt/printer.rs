//! Sending formatted lines to the configured printer.

use sea_orm::DatabaseConnection;

use super::settings::{get_printer_settings, receipt_render_settings, ReceiptRenderSettings};
use crate::domain::receipt::PrinterInfoItem;
use crate::entity::store_info;
use crate::printing::layout::columns;
use crate::printing::raster::{render_lines, DOTS_58MM, DOTS_80MM};
use crate::printing::receipt::{format_test_page_text, PrintMode, ReceiptTextLine};
use crate::printing::system_printer;
use crate::utils::AppError;

/// Encode the lines and send them, unchanged, to the system printer.
///
/// In raster mode the text is drawn in the bundled typewriter face and the
/// picture is sent: one uniform face across the slip. In text mode the
/// characters go to the printer's own font engine, as the Mitra Indogrosir app
/// prints: faster and much smaller, but bold and double-size read as different
/// fonts. See `PrintMode`.
fn send_to_printer(
    printer_id: &str,
    lines: &[ReceiptTextLine],
    paper_width: u8,
    mode: PrintMode,
) -> Result<(), String> {
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
    system_printer::send_raw_data(printer_id, &bytes)
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
        .filter(|id| !id.is_empty())
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
        // A failed enumeration (spooler stopped, say) is an error the screen
        // should show, not an empty list that reads as "no printers here".
        let printers = system_printer::list_printers()?
            .into_iter()
            .map(|p| PrinterInfoItem {
                id: p.id,
                name: if p.is_default {
                    format!("{} (Default)", p.name)
                } else {
                    p.name
                },
                printer_type: p.kind.as_str().to_string(),
                is_default: p.is_default,
            })
            .collect();
        Ok::<Vec<PrinterInfoItem>, String>(printers)
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

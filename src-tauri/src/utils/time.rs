//! Timestamps in the shape the schema stores them, and the local calendar-day
//! boundaries the list and report filters compare them against.
//!
//! Every timestamp column (`created_at`, `updated_at`, `expires_at`, ...) holds
//! UTC at second precision as `"YYYY-MM-DD HH:MM:SS"`, which sorts
//! lexicographically in the same order it sorts chronologically. Filters take a
//! local calendar date from the user, so they convert that date into a raw UTC
//! boundary instead of wrapping the column in `date(created_at,'localtime')`,
//! which would defeat the date indexes.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, Utc};

use crate::utils::AppError;

/// The `strftime` pattern of every stored timestamp.
pub const TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// `at` in the stored timestamp shape.
pub fn format_ts(at: DateTime<Utc>) -> String {
    at.format(TIMESTAMP_FORMAT).to_string()
}

/// The current instant in the stored timestamp shape. Always UTC: every reader
/// converts a local date into a UTC boundary before comparing.
pub fn now_ts() -> String {
    format_ts(Utc::now())
}

/// A `YYYY-MM-DD` calendar date, as the filters receive it.
pub fn parse_date(date_str: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()
}

/// An optional `YYYY-MM-DD` filter bound as a list endpoint receives it.
///
/// Absent or blank means "no bound"; anything else has to be a calendar date.
/// A malformed date used to be dropped silently, so a typo widened the list to
/// every row instead of telling the caller the filter was wrong.
pub fn parse_date_filter(raw: Option<&str>) -> Result<Option<NaiveDate>, AppError> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(date) => parse_date(date).map(Some).ok_or_else(invalid_date),
    }
}

/// The message every date filter answers with when the date it was given
/// cannot be turned into a UTC boundary.
pub const INVALID_DATE: &str = "Tanggal tidak valid";

/// The validation error for a date that is malformed, or so close to the edge
/// of the calendar chrono can represent that its boundary cannot be computed.
pub fn invalid_date() -> AppError {
    AppError::Validation(INVALID_DATE.to_string())
}

/// A local wall-clock time as a stored UTC timestamp, shifted by the machine's
/// current UTC offset.
///
/// `None` when the shift leaves chrono's range, or when the UTC year falls
/// outside `0000..=9999`. Only a four-digit year formats as a string that sorts
/// against the stored timestamps: chrono writes year 10000 as `+10000-...` and
/// year -1 as `-0001-...`, both of which compare below every real timestamp,
/// so a boundary like that silently empties (or never narrows) the range it
/// bounds.
pub fn local_to_utc(local: NaiveDateTime) -> Option<String> {
    let offset = Duration::seconds(Local::now().offset().local_minus_utc() as i64);
    local
        .checked_sub_signed(offset)
        .filter(|utc| (0..=9999).contains(&utc.year()))
        .map(|utc| utc.format(TIMESTAMP_FORMAT).to_string())
}

/// UTC boundary for 00:00:00 local on `date`: the inclusive lower bound of that
/// day.
pub fn local_date_start_to_utc(date: NaiveDate) -> Option<String> {
    local_to_utc(date.and_time(NaiveTime::MIN))
}

/// UTC boundary for 00:00:00 local on the day AFTER `date`: the exclusive upper
/// bound. `created_at < this` reproduces `date(created_at,'localtime') <= date`
/// exactly, whatever the timestamp's sub-second precision.
pub fn local_date_end_exclusive_to_utc(date: NaiveDate) -> Option<String> {
    local_date_start_to_utc(date.succ_opt()?)
}

/// UTC boundary for 23:59:59 local on `date`: the inclusive upper bound the
/// paginated lists compare with `<=`.
pub fn local_date_last_second_to_utc(date: NaiveDate) -> Option<String> {
    local_to_utc(date.and_hms_opt(23, 59, 59)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_ts_is_second_precision_utc() {
        let at = DateTime::parse_from_rfc3339("2026-09-05T12:34:56.789+00:00")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(format_ts(at), "2026-09-05 12:34:56");
    }

    #[test]
    fn day_boundaries_shift_by_the_local_offset() {
        let offset = Duration::seconds(Local::now().offset().local_minus_utc() as i64);
        let date = parse_date("2026-09-05").expect("valid date");
        let midnight = date.and_hms_opt(0, 0, 0).unwrap();

        assert_eq!(
            local_date_start_to_utc(date),
            Some((midnight - offset).format(TIMESTAMP_FORMAT).to_string())
        );
        assert_eq!(
            local_date_end_exclusive_to_utc(date),
            Some(
                (midnight + Duration::days(1) - offset)
                    .format(TIMESTAMP_FORMAT)
                    .to_string()
            )
        );
        assert_eq!(
            local_date_last_second_to_utc(date),
            Some(
                (midnight + Duration::seconds(86_399) - offset)
                    .format(TIMESTAMP_FORMAT)
                    .to_string()
            )
        );
    }

    #[test]
    fn parse_date_rejects_anything_but_a_calendar_date() {
        assert!(parse_date("2026-02-30").is_none());
        assert!(parse_date("05/09/2026").is_none());
        assert!(parse_date("").is_none());
    }

    /// The last day chrono can represent has no next day, and shifting either
    /// edge of the calendar can leave chrono's range: both used to panic on a
    /// date that came straight off the query string. Both edges are also far
    /// outside the four-digit years, so they have no boundary whatever the
    /// machine's offset.
    #[test]
    fn the_edges_of_the_calendar_have_no_boundary() {
        assert_eq!(local_date_end_exclusive_to_utc(NaiveDate::MAX), None);
        assert_eq!(local_to_utc(NaiveDateTime::MAX), None);
        assert_eq!(local_date_start_to_utc(NaiveDate::MIN), None);
        assert_eq!(local_date_last_second_to_utc(NaiveDate::MAX), None);
    }

    #[test]
    fn every_ordinary_day_has_all_three_boundaries() {
        let date = parse_date("2026-12-31").expect("valid date");
        assert!(local_date_start_to_utc(date).is_some());
        assert!(local_date_end_exclusive_to_utc(date).is_some());
        assert!(local_date_last_second_to_utc(date).is_some());
    }

    /// A boundary outside the four-digit years formats as `+10000-...` or
    /// `-0001-...`, which sorts below every stored timestamp; it is `None`
    /// rather than a string that quietly empties the range.
    #[test]
    fn a_boundary_outside_the_four_digit_years_is_none() {
        let far = parse_date("+10000-06-15").expect("chrono parses a signed five-digit year");
        assert_eq!(local_date_start_to_utc(far), None);
        assert_eq!(local_date_end_exclusive_to_utc(far), None);
        assert_eq!(local_date_last_second_to_utc(far), None);

        let ancient = NaiveDate::from_ymd_opt(-1, 6, 15).expect("valid date");
        assert_eq!(local_date_start_to_utc(ancient), None);

        // The ordinary edges of the range still format as sortable strings.
        let early = NaiveDate::from_ymd_opt(1, 6, 15).expect("valid date");
        let start = local_date_start_to_utc(early).expect("year 1 boundary");
        assert!(start.starts_with("0001-06-1"), "{start}");
        let late = NaiveDate::from_ymd_opt(9999, 6, 15).expect("valid date");
        let end = local_date_end_exclusive_to_utc(late).expect("year 9999 boundary");
        assert!(end.starts_with("9999-06-1"), "{end}");
    }

    #[test]
    fn a_date_filter_is_absent_valid_or_an_error() {
        assert_eq!(parse_date_filter(None).ok(), Some(None));
        assert_eq!(parse_date_filter(Some("  ")).ok(), Some(None));
        assert_eq!(
            parse_date_filter(Some("2026-09-05")).ok(),
            Some(parse_date("2026-09-05"))
        );
        for bad in ["2026-02-30", "05/09/2026", "kemarin"] {
            assert!(
                matches!(parse_date_filter(Some(bad)), Err(AppError::Validation(message)) if message == INVALID_DATE),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn the_invalid_date_error_is_a_validation_error() {
        assert!(matches!(invalid_date(), AppError::Validation(message) if message == INVALID_DATE));
    }
}

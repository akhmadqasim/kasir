//! Page-size and offset arithmetic shared by the paginated list endpoints.

/// Page size to actually use: 50 when none was asked for, clamped to `1..=100`.
///
/// Zero would divide the row count by zero when `total_pages` is worked out,
/// a negative size makes no sense, and an uncapped upper end lets a single
/// request pull a whole history into memory. Generic because the list inputs
/// carry their page numbers as `i64` or `u64`, whichever their domain type uses.
pub fn clamp_per_page<T: Ord + From<u8>>(requested: Option<T>) -> T {
    requested
        .unwrap_or(T::from(50))
        .clamp(T::from(1), T::from(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_per_page_bounds_the_requested_page_size() {
        assert_eq!(clamp_per_page::<i64>(None), 50);
        assert_eq!(clamp_per_page(Some(25_i64)), 25);
        assert_eq!(clamp_per_page(Some(0_i64)), 1);
        assert_eq!(clamp_per_page(Some(-10_i64)), 1);
        assert_eq!(clamp_per_page(Some(5_000_u64)), 100);
        assert_eq!(clamp_per_page(Some(0_u64)), 1);
    }
}

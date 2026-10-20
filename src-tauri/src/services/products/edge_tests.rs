//! Edge cases for the catalogue: code uniqueness and NULL handling, search by
//! name, barcode, SKU and price, literal LIKE matching, paging bounds and the
//! lookup cap.

use sea_orm::DatabaseConnection;

use super::lookup::MAX_LOOKUP_IDS;
use super::test_fixtures::{admin, make_valid_input};
use super::*;
use crate::domain::products::{ProductSearchParams, UpdateProductInput};
use crate::domain::Actor;
use crate::entity::products;
use crate::test_support::setup_test_db;
use crate::utils::AppError;

fn params(query: Option<&str>) -> ProductSearchParams {
    ProductSearchParams {
        query: query.map(str::to_string),
        category_id: None,
        quick_filter: None,
        page: None,
        per_page: None,
        sort_by: None,
        sort_order: None,
    }
}

async fn make(
    conn: &DatabaseConnection,
    name: &str,
    barcode: Option<&str>,
    sku: Option<&str>,
) -> products::Model {
    let mut input = make_valid_input();
    input.name = name.to_string();
    input.barcode = barcode.map(str::to_string);
    input.sku = sku.map(str::to_string);
    create(conn, &admin(), input).await.expect("product")
}

async fn names(conn: &DatabaseConnection, query: &str) -> Vec<String> {
    let mut found: Vec<String> = search(conn, params(Some(query)))
        .await
        .expect("search")
        .data
        .into_iter()
        .map(|p| p.name)
        .collect();
    found.sort();
    found
}

fn edit(product: &products::Model) -> UpdateProductInput {
    UpdateProductInput {
        id: product.id,
        barcode: product.barcode.clone(),
        sku: product.sku.clone(),
        name: product.name.clone(),
        category_id: product.category_id,
        buy_price: product.buy_price,
        sell_price: product.sell_price,
        margin: None,
        stock: None,
        expected_stock: None,
        unit: product.unit.clone(),
        min_stock: product.min_stock,
    }
}

fn is_validation<T: std::fmt::Debug>(result: &Result<T, AppError>) -> bool {
    matches!(result, Err(AppError::Validation(_)))
}

// ---------------------------------------------------------------------------
// Codes: uniqueness, trimming and NULL
// ---------------------------------------------------------------------------

/// Codes are stored trimmed, so a scan of the bare code finds a product whose
/// barcode was typed with spaces around it, and a clash is caught on the
/// trimmed value.
#[tokio::test]
async fn codes_are_trimmed_before_they_are_stored_and_compared() {
    let conn = setup_test_db().await;
    let beras = make(&conn, "Beras", Some("  8991234567890 "), Some(" SKU-9 ")).await;
    assert_eq!(beras.barcode.as_deref(), Some("8991234567890"));
    assert_eq!(beras.sku.as_deref(), Some("SKU-9"));

    let found = get_by_barcode(&conn, "8991234567890")
        .await
        .expect("lookup")
        .expect("found");
    assert_eq!(found.id, beras.id);

    let mut clash = make_valid_input();
    clash.name = "Gula".to_string();
    clash.barcode = Some("8991234567890  ".to_string());
    clash.sku = None;
    assert!(is_validation(&create(&conn, &admin(), clash).await));

    let mut clash = make_valid_input();
    clash.name = "Gula".to_string();
    clash.barcode = None;
    clash.sku = Some("SKU-9".to_string());
    assert!(is_validation(&create(&conn, &admin(), clash).await));
}

/// Any number of products may go without a barcode or SKU, and clearing a
/// code on edit frees it for another product.
#[tokio::test]
async fn products_without_codes_never_collide_and_a_cleared_code_is_free() {
    let conn = setup_test_db().await;
    for name in ["Curah 1", "Curah 2", "Curah 3"] {
        let product = make(&conn, name, None, None).await;
        assert_eq!((product.barcode, product.sku), (None, None));
    }

    let first = make(&conn, "Pertama", Some("1111111111111"), Some("A-1")).await;
    let cleared = update(
        &conn,
        &admin(),
        UpdateProductInput {
            barcode: Some("  ".to_string()),
            sku: None,
            ..edit(&first)
        },
    )
    .await
    .expect("clear codes");
    assert_eq!((cleared.barcode, cleared.sku), (None, None));

    let second = make(&conn, "Kedua", Some("1111111111111"), Some("A-1")).await;
    assert_eq!(second.barcode.as_deref(), Some("1111111111111"));
}

/// A barcode and a SKU live in different columns: one product's SKU may equal
/// another's barcode, and search finds both.
#[tokio::test]
async fn a_sku_may_equal_another_products_barcode() {
    let conn = setup_test_db().await;
    make(&conn, "Pakai barcode", Some("12345"), None).await;
    make(&conn, "Pakai SKU", None, Some("12345")).await;

    assert_eq!(
        names(&conn, "12345").await,
        vec!["Pakai SKU", "Pakai barcode"]
    );
}

/// Once a deleted product has given its barcode up, a scan finds the new
/// product, and never the deleted one.
#[tokio::test]
async fn a_scan_finds_the_live_product_never_the_deleted_one() {
    let conn = setup_test_db().await;
    let old = make(&conn, "Lama", Some("8990000000001"), None).await;
    delete(&conn, &admin(), old.id).await.expect("delete");
    assert!(get_by_barcode(&conn, "8990000000001")
        .await
        .expect("lookup")
        .is_none());

    let new = make(&conn, "Baru", Some("8990000000001"), None).await;
    let found = get_by_barcode(&conn, "8990000000001")
        .await
        .expect("lookup")
        .expect("found");
    assert_eq!(found.id, new.id);
    assert!(names(&conn, "8990000000001").await == vec!["Baru"]);
}

/// An edit aimed at a deleted or missing product is a 404, and a cashier can
/// neither edit nor delete.
#[tokio::test]
async fn edits_need_a_live_product_and_an_admin() {
    let conn = setup_test_db().await;
    let product = make(&conn, "Beras", None, None).await;
    let kasir = Actor::new(2, "kasir");

    assert!(matches!(
        update(&conn, &kasir, edit(&product)).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        delete(&conn, &kasir, product.id).await,
        Err(AppError::Forbidden(_))
    ));

    delete(&conn, &admin(), product.id).await.expect("delete");
    assert!(matches!(
        update(&conn, &admin(), edit(&product)).await,
        Err(AppError::NotFound(_))
    ));
    let mut missing = edit(&product);
    missing.id = 9_999;
    assert!(matches!(
        update(&conn, &admin(), missing).await,
        Err(AppError::NotFound(_))
    ));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// Name search is a case-insensitive substring match; barcode and SKU are
/// prefix matches; a whitespace-only query is no filter at all.
#[tokio::test]
async fn search_matches_names_anywhere_and_codes_from_the_front() {
    let conn = setup_test_db().await;
    make(
        &conn,
        "Minyak Goreng 1L",
        Some("8997000000011"),
        Some("MG-01"),
    )
    .await;
    make(&conn, "Gula Pasir", Some("8997000000028"), Some("GP-02")).await;

    assert_eq!(names(&conn, "GORENG").await, vec!["Minyak Goreng 1L"]);
    assert_eq!(names(&conn, "  pasir  ").await, vec!["Gula Pasir"]);
    assert_eq!(names(&conn, "mg-").await, vec!["Minyak Goreng 1L"]);
    assert!(
        names(&conn, "-01").await.is_empty(),
        "SKU is not a substring match"
    );
    assert_eq!(names(&conn, "8997").await.len(), 2);
    assert_eq!(names(&conn, "   ").await.len(), 2);
}

/// Quotes, backslashes and wildcards in the box are plain characters.
#[tokio::test]
async fn search_treats_quotes_backslashes_and_wildcards_literally() {
    let conn = setup_test_db().await;
    make(&conn, "Kopi O'Neil", None, None).await;
    make(&conn, "Sabun A\\B", None, None).await;
    make(&conn, "Teh_Celup", None, None).await;
    make(&conn, "Teh Celup", None, None).await;

    assert_eq!(names(&conn, "o'neil").await, vec!["Kopi O'Neil"]);
    assert_eq!(names(&conn, "a\\b").await, vec!["Sabun A\\B"]);
    assert_eq!(names(&conn, "teh_").await, vec!["Teh_Celup"]);
    assert!(names(&conn, "%").await.is_empty());
}

/// A number in the box also finds the product with that sell price.
#[tokio::test]
async fn a_number_finds_the_product_with_that_price() {
    let conn = setup_test_db().await;
    let mut input = make_valid_input();
    input.name = "Roti".to_string();
    input.barcode = None;
    input.sku = None;
    input.buy_price = 6_000.0;
    input.sell_price = 7_500.0;
    create(&conn, &admin(), input).await.expect("product");
    make(&conn, "Beras", None, None).await;

    assert_eq!(names(&conn, "7500").await, vec!["Roti"]);
}

/// Deleted products stay out of search, even on an exact barcode.
#[tokio::test]
async fn search_never_returns_a_deleted_product() {
    let conn = setup_test_db().await;
    let gone = make(&conn, "Dihapus", Some("8991111111111"), Some("DEL-1")).await;
    delete(&conn, &admin(), gone.id).await.expect("delete");

    for query in ["Dihapus", "8991111111111", "1111111", "DEL-1"] {
        assert!(names(&conn, query).await.is_empty(), "{query}");
    }
}

/// The category filter and the text search narrow the list together.
#[tokio::test]
async fn category_and_query_filters_combine() {
    let conn = setup_test_db().await;
    let category = crate::services::categories::create(
        &conn,
        &admin(),
        crate::domain::categories::CreateCategoryInput {
            name: "Minuman".to_string(),
            description: None,
        },
    )
    .await
    .expect("category");
    let mut input = make_valid_input();
    input.name = "Teh Botol".to_string();
    input.barcode = None;
    input.sku = None;
    input.category_id = Some(category.id);
    create(&conn, &admin(), input).await.expect("product");
    make(&conn, "Teh Celup", None, None).await;

    let mut filtered = params(Some("teh"));
    filtered.category_id = Some(category.id);
    let result = search(&conn, filtered).await.expect("search");
    assert_eq!(result.total, 1);
    assert_eq!(result.data[0].name, "Teh Botol");
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/// `total_pages` rounds up, an empty list is still one page, a page number
/// below one is page one, and a page far past the end is empty rather than an
/// error or an overflow.
#[tokio::test]
async fn paging_bounds_hold_at_both_ends() {
    let conn = setup_test_db().await;
    let empty = search(&conn, params(None)).await.expect("search");
    assert_eq!((empty.total, empty.total_pages, empty.page), (0, 1, 1));

    for i in 0..101 {
        make(&conn, &format!("Produk {i:03}"), None, None).await;
    }

    let mut page = params(None);
    page.per_page = Some(50);
    let first = search(&conn, page.clone()).await.expect("search");
    assert_eq!((first.total, first.total_pages), (101, 3));

    for below in [0, -1, i64::MIN] {
        let mut p = page.clone();
        p.page = Some(below);
        let result = search(&conn, p).await.expect("search");
        assert_eq!(result.page, 1, "page {below}");
        assert_eq!(result.data[0].name, "Produk 000");
    }

    let mut last = page.clone();
    last.page = Some(3);
    let result = search(&conn, last).await.expect("search");
    assert_eq!(result.data.len(), 1);
    assert_eq!(result.data[0].name, "Produk 100");

    for past in [4, i64::MAX] {
        let mut p = page.clone();
        p.page = Some(past);
        p.per_page = Some(i64::MAX);
        let result = search(&conn, p).await.expect("search");
        assert!(result.data.is_empty(), "page {past}");
        assert_eq!(result.total, 101);
        assert_eq!(result.per_page, 100);
    }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/// Exactly the cap is accepted; blanks and spaces are skipped before counting.
#[tokio::test]
async fn lookup_accepts_exactly_the_cap() {
    let raw = (1..=MAX_LOOKUP_IDS as i64)
        .map(|id| format!(" {id} "))
        .collect::<Vec<_>>()
        .join(",");
    let raw = format!(",,{raw},,");
    assert_eq!(parse_lookup_ids(&raw).expect("ids").len(), MAX_LOOKUP_IDS);

    assert!(parse_lookup_ids("1.5").is_err());
    assert!(parse_lookup_ids("99999999999999999999").is_err());
    assert_eq!(parse_lookup_ids("-3").expect("ids"), vec![-3]);
}

/// Deleted products come back flagged, and repeated ids give one row each.
#[tokio::test]
async fn lookup_flags_deleted_products_and_ignores_repeats() {
    let conn = setup_test_db().await;
    let live = make(&conn, "Hidup", None, None).await;
    let gone = make(&conn, "Mati", None, None).await;
    delete(&conn, &admin(), gone.id).await.expect("delete");

    let mut rows = lookup(&conn, &[live.id, live.id, gone.id, -1])
        .await
        .expect("lookup");
    rows.sort_by_key(|p| p.id);
    let flags: Vec<(i64, bool)> = rows.iter().map(|p| (p.id, p.is_active)).collect();
    assert_eq!(flags, vec![(live.id, true), (gone.id, false)]);

    assert!(lookup(&conn, &[]).await.expect("lookup").is_empty());
}

/// Raising a product's reorder point on edit moves it into the low-stock
/// quick filter straight away.
#[tokio::test]
async fn an_edit_that_raises_the_threshold_moves_a_product_into_low_stock() {
    let conn = setup_test_db().await;
    // Stock 100, reorder point 10: not low.
    let product = make(&conn, "Telur", None, None).await;

    let mut low = params(None);
    low.quick_filter = Some("low_stock".to_string());
    assert_eq!(search(&conn, low.clone()).await.expect("search").total, 0);

    update(
        &conn,
        &admin(),
        UpdateProductInput {
            min_stock: Some(100),
            ..edit(&product)
        },
    )
    .await
    .expect("update");
    assert_eq!(search(&conn, low).await.expect("search").total, 1);
}

//! Search across every payment-point group's sub-menu at once — "cari
//! Indihome" instead of "pick a category, then scroll for Indihome".
//!
//! The upstream has no search endpoint of its own: [`menu::menu`] lists the
//! groups (Listrik, Internet & TV, ...) and [`menu::pp_sub_menu`] lists one
//! group's billers. Answering a search means having asked `pp/get-sub-menu`
//! for every group at least once, which is one request per keystroke fan-out
//! too many — so the flattened index is built once and kept for
//! [`SEARCH_CACHE_TTL`], the same shape as [`super::history::DETAIL_CACHE`].

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use sea_orm::DatabaseConnection;
use tokio::sync::Mutex;
use tokio::task::JoinSet;

use crate::domain::ppob::{PpSearchGroupRef, PpSearchResult};
use crate::services::ppob::client::MitraClient;
use crate::services::ppob::menu;
use crate::services::ppob::session_cache::{SessionCache, Ticket};
use crate::utils::AppError;

/// How long the flattened index is trusted before the next search rebuilds
/// it. Billers change rarely enough that a cashier's shift does not need to
/// see one added mid-morning; [`forget_index`] clears it sooner, on its own
/// trigger (a Mitra logout or a fresh login).
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);

/// How long an index missing a group that failed to answer is kept: long
/// enough that a search per keystroke does not refetch every group, short
/// enough that a passing hiccup does not hide those billers for the day.
const PARTIAL_INDEX_TTL: Duration = Duration::from_secs(60);

/// At most this many results, so a broad query like "bank" — which matches
/// dozens of billers — does not turn the popover into a second scrollable
/// list the cashier has to read past.
const MAX_RESULTS: usize = 20;

/// The index behind an `Arc`: a search hits the cache far more often than it
/// rebuilds it, and without this every one of those hits would deep-clone the
/// whole catalogue just to read it. An `Arc` clone is a refcount bump.
///
/// Stored with the instant it expires, since not every index is trusted for
/// the same [`SEARCH_CACHE_TTL`].
type SearchCache = Option<(Instant, Arc<Vec<PpSearchResult>>)>;

static SEARCH_CACHE: LazyLock<SessionCache<SearchCache>> = LazyLock::new(SessionCache::new);

fn cached_index() -> Option<Arc<Vec<PpSearchResult>>> {
    SEARCH_CACHE
        .read(|cache| {
            cache
                .as_ref()
                .filter(|(expires_at, _)| Instant::now() < *expires_at)
                .map(|(_, index)| index.clone())
        })
        .flatten()
}

/// Keep `index` for `ttl`, unless the session was forgotten since `ticket`
/// was taken: then the index is the previous account's, and is dropped.
fn store_index(ticket: Ticket, index: Arc<Vec<PpSearchResult>>, ttl: Duration) {
    SEARCH_CACHE.store(ticket, |cache| {
        *cache = Some((Instant::now() + ttl, index));
    });
}

/// Drop the cached index. Called when the Mitra session is cleared: a
/// different account can see a different set of payment points, and the
/// cache must not answer a search from the previous one's catalogue — nor
/// from a rebuild that was still in flight when the session ended.
pub fn forget_index() {
    SEARCH_CACHE.forget();
}

/// Serialises rebuilding a cold cache: without this, two searches that both
/// see an empty cache (right after startup, a logout, or a TTL expiry) would
/// each fan out a full round of `pp_sub_menu` calls at once instead of the
/// second one simply waiting for the first's answer.
static BUILD_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Every group's sub-menu, flattened and cached. Rebuilt at most once per
/// [`SEARCH_CACHE_TTL`], and fetched one group at a time concurrently rather
/// than in series — a shop with two dozen payment-point groups would
/// otherwise pay two dozen sequential round trips to Mitra on the one search
/// that finds the cache cold.
async fn payment_point_index(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
) -> Result<Arc<Vec<PpSearchResult>>, AppError> {
    if let Some(index) = cached_index() {
        return Ok(index);
    }

    // Whoever gets here first rebuilds; anyone that raced them just waits for
    // the lock and then finds the cache the first caller already filled.
    let _building = BUILD_LOCK.lock().await;
    if let Some(index) = cached_index() {
        return Ok(index);
    }

    // Taken before the first upstream request: a forget from here on means
    // what this rebuild fetches belongs to a session that has ended.
    let ticket = SEARCH_CACHE.ticket();
    let groups = menu::menu(db, mitra).await?;

    let mut fetches = JoinSet::new();
    for (position, group) in groups.into_iter().enumerate() {
        let db = db.clone();
        let mitra = Arc::clone(mitra);
        fetches.spawn(async move {
            let sub_menu = menu::pp_sub_menu(&db, &mitra, group.id).await;
            (position, group, sub_menu)
        });
    }

    // One group failing to answer must not fail the whole index — a biller
    // under a broken group is simply absent from search, the same as if the
    // cashier had opened that group by hand and seen nothing. Such an index is
    // only kept for [`PARTIAL_INDEX_TTL`], and if no group answered at all the
    // search fails instead of reporting that nothing matched.
    let mut answered = Vec::new();
    let mut failure = None;
    while let Some(joined) = fetches.join_next().await {
        match joined {
            Ok((position, group, Ok(sub_menu))) => answered.push((position, group, sub_menu)),
            Ok((_, _, Err(e))) => failure = Some(e),
            Err(e) => failure = Some(AppError::Internal(format!("Gagal memuat sub-menu: {e}"))),
        }
    }
    if answered.is_empty() {
        if let Some(e) = failure {
            return Err(e);
        }
    }

    // Groups answer in whatever order they finish; put them back in the
    // menu's own order so ties in [`rank_matches`] stay stable.
    answered.sort_by_key(|(position, _, _)| *position);

    let mut index = Vec::new();
    for (_, group, sub_menu) in answered {
        let group_ref = PpSearchGroupRef {
            id: group.id,
            name: group.group,
        };
        index.extend(sub_menu.into_iter().map(|item| PpSearchResult {
            id: item.id,
            plu: item.plu,
            merchant: item.merchant,
            description: item.description,
            label: item.label,
            input_amt: item.input_amt,
            is_trouble: item.is_trouble,
            path_icon: item.path_icon,
            group: group_ref.clone(),
        }));
    }

    let index = Arc::new(index);
    let ttl = if failure.is_some() {
        PARTIAL_INDEX_TTL
    } else {
        SEARCH_CACHE_TTL
    };
    store_index(ticket, index.clone(), ttl);
    Ok(index)
}

/// Rank the flattened index against `query`: a prefix match on the merchant
/// or description first, then everything else that merely contains the query
/// somewhere in the merchant, description or group name. Ties keep the
/// index's own order, which is itself alphabetical — Mitra returns each
/// group's sub-menu that way already.
///
/// Kept apart from [`search`] so the ranking itself is testable without a
/// network call or the cache.
fn rank_matches(index: &[PpSearchResult], query: &str) -> Vec<PpSearchResult> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }

    let mut ranked: Vec<(u8, &PpSearchResult)> = index
        .iter()
        .filter_map(|item| {
            let merchant = item.merchant.to_lowercase();
            let description = item.description.to_lowercase();

            if merchant.starts_with(&query) || description.starts_with(&query) {
                return Some((0, item));
            }

            let group = item.group.name.to_lowercase();
            if merchant.contains(&query) || description.contains(&query) || group.contains(&query) {
                return Some((1, item));
            }

            None
        })
        .collect();

    // `sort_by_key` is stable, so ties keep the filter's own (index) order.
    ranked.sort_by_key(|(rank, _)| *rank);
    ranked
        .into_iter()
        .take(MAX_RESULTS)
        .map(|(_, item)| item.clone())
        .collect()
}

/// Every payment-point biller whose merchant, description or group name
/// matches `query`, ranked and capped at [`MAX_RESULTS`].
pub async fn search(
    db: &DatabaseConnection,
    mitra: &Arc<Mutex<MitraClient>>,
    query: &str,
) -> Result<Vec<PpSearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let index = payment_point_index(db, mitra).await?;
    Ok(rank_matches(&index, query))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `PpSearchResult`, built the way [`payment_point_index`] builds one —
    /// entries below are excerpted from real `pp/get-sub-menu` fixtures
    /// (`pp_get-sub-menu_33.json` for group 33 "Internet & TV",
    /// `pp_get-sub-menu_6.json` for group 6 "Multi Finance").
    fn item(
        id: i64,
        merchant: &str,
        description: &str,
        group_id: i64,
        group_name: &str,
    ) -> PpSearchResult {
        PpSearchResult {
            id,
            plu: format!("plu-{id}"),
            merchant: merchant.to_string(),
            description: description.to_string(),
            label: "Kode Pembayaran".to_string(),
            input_amt: 1,
            is_trouble: 2,
            path_icon: None,
            group: PpSearchGroupRef {
                id: group_id,
                name: group_name.to_string(),
            },
        }
    }

    fn fixture() -> Vec<PpSearchResult> {
        vec![
            item(1590, "Bigband", "Bigband", 33, "Internet & TV"),
            item(354, "Indihome", "Telkom Indihome", 33, "Internet & TV"),
            item(367, "My Republic", "MyRepublic", 33, "Internet & TV"),
            item(540, "ADIRA Finance", "Adira Finance", 6, "Multi Finance"),
            item(541, "AEON Cicilan", "AEON Cicilan", 6, "Multi Finance"),
        ]
    }

    #[test]
    fn matches_case_insensitively_on_merchant_or_description() {
        let index = fixture();

        // "My Republic" the merchant has a space Mitra's own description does
        // not ("MyRepublic"); the query without one only matches on
        // description, which is exactly why both fields are searched.
        let by_description = rank_matches(&index, "myrepub");
        assert_eq!(by_description.len(), 1);
        assert_eq!(by_description[0].merchant, "My Republic");

        let by_merchant = rank_matches(&index, "TELKOM");
        assert_eq!(by_merchant.len(), 1);
        assert_eq!(by_merchant[0].merchant, "Indihome");
    }

    #[test]
    fn matches_on_the_group_name_too() {
        let index = fixture();
        let results = rank_matches(&index, "multi finance");
        let merchants: Vec<&str> = results.iter().map(|r| r.merchant.as_str()).collect();
        assert_eq!(merchants, vec!["ADIRA Finance", "AEON Cicilan"]);
    }

    #[test]
    fn ranks_a_prefix_match_before_a_contains_match() {
        let index = fixture();
        // Every merchant/description containing an "a" matches; "ADIRA
        // Finance" and "AEON Cicilan" start with it, "Bigband" only contains
        // one mid-word, and the ranking must put the two prefix matches
        // first without disturbing their own relative order.
        let results = rank_matches(&index, "a");
        let merchants: Vec<&str> = results.iter().map(|r| r.merchant.as_str()).collect();
        assert_eq!(merchants, vec!["ADIRA Finance", "AEON Cicilan", "Bigband"]);
    }

    #[test]
    fn an_empty_or_blank_query_matches_nothing() {
        let index = fixture();
        assert!(rank_matches(&index, "").is_empty());
        assert!(rank_matches(&index, "   ").is_empty());
    }

    /// A logout while the index is being rebuilt must win: the rebuild that
    /// finishes afterwards holds the previous account's catalogue.
    #[test]
    fn an_index_rebuilt_across_a_forget_is_not_kept() {
        let ticket = SEARCH_CACHE.ticket();
        forget_index();
        store_index(ticket, Arc::new(fixture()), SEARCH_CACHE_TTL);
        assert!(cached_index().is_none());
    }

    #[test]
    fn caps_at_max_results() {
        let index: Vec<PpSearchResult> = (0..25)
            .map(|i| item(i, &format!("Merchant Contoh {i}"), "desc", 1, "Grup"))
            .collect();
        let results = rank_matches(&index, "merchant");
        assert_eq!(results.len(), MAX_RESULTS);
    }
}

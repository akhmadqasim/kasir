//! Escalating backoff for failed logins.
//!
//! A PIN is four to six digits, so the whole key space is at most ten thousand
//! values. Unthrottled, a script on the shop LAN walks all of it in the time it
//! takes bcrypt to run ten thousand times — minutes on a modern CPU if requests
//! are issued in parallel. Rate limiting is not a nicety here; it is the only
//! thing standing between the LAN and every account.
//!
//! Counting is done per username *and* per client address, and a request is
//! refused if either counter is in backoff. Per-username alone lets one attacker
//! spray many usernames from one machine; per-address alone lets a botnet grind
//! one account. Neither is enough on its own.
//!
//! State is in memory. Restarting the app clears it, which is the right
//! trade-off for a single-terminal POS: an attacker cannot force a restart, and
//! a shopkeeper who locked themselves out has an obvious remedy.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

/// Failures allowed before any delay is imposed. Three covers a mistyped PIN and
/// a second try without annoying anybody.
const FREE_ATTEMPTS: u32 = 3;

/// The first lock, doubling with every further failure.
const BASE_LOCK_SECS: u64 = 5;

/// Ceiling on the lock. Fifteen minutes per attempt puts a ten-thousand-value
/// search beyond three months.
const MAX_LOCK_SECS: u64 = 900;

/// A counter this old is forgotten, so an honest user who fumbles once a week
/// never accumulates a lockout. Comfortably longer than [`MAX_LOCK_SECS`]: if
/// serving out the longest lock also wiped the counter, an attacker would get a
/// fresh budget of free attempts every fifteen minutes.
const RESET_AFTER: Duration = Duration::from_secs(60 * 60);

/// Above this many tracked keys, forgotten entries are swept. Only reached by an
/// attacker cycling usernames or addresses; normal use holds a handful.
const PRUNE_THRESHOLD: usize = 1024;

/// Hard cap on tracked keys. Past it, the least recently failed entries are
/// dropped even if not yet stale, so memory stays bounded.
const MAX_TRACKED_KEYS: usize = 4096;

/// Key text longer than this is stored as its SHA-256, so a huge username or
/// forwarded address costs a fixed amount of memory.
const MAX_KEY_TEXT_CHARS: usize = 64;

#[derive(Debug, Clone)]
struct Failures {
    count: u32,
    last_failure: Instant,
    locked_until: Option<Instant>,
}

#[derive(Debug, Default)]
pub struct LoginThrottle {
    entries: Mutex<HashMap<String, Failures>>,
}

/// Key for the username side of the count. Lower-cased so `Admin` and `admin`
/// share a counter — usernames are compared case-sensitively by the login query,
/// but an attacker must not get a fresh budget just by changing case.
pub fn username_key(username: &str) -> String {
    bounded_key("u", &username.trim().to_lowercase())
}

/// Key for wrong current-PIN guesses on the own-PIN form. That form checks the
/// same secret a login does, from a live session, so it is held to the same
/// backoff — counted per account, since the session already names it.
pub fn pin_change_key(user_id: i64) -> String {
    format!("p:{user_id}")
}

/// Key for the client-address side of the count.
pub fn address_key(address: &str) -> String {
    bounded_key("a", address)
}

/// `prefix:text`, or `prefix#<sha256>` when `text` is too long to keep.
fn bounded_key(prefix: &str, text: &str) -> String {
    if text.chars().count() <= MAX_KEY_TEXT_CHARS {
        format!("{prefix}:{text}")
    } else {
        format!("{prefix}#{}", hex::encode(Sha256::digest(text.as_bytes())))
    }
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Admit one login attempt, or say how long the caller must wait.
    ///
    /// An admitted attempt is charged as a failure *now*, under the same lock
    /// as the check, and [`record_success`](Self::record_success) takes the
    /// charge back. Checking first and recording only once bcrypt has answered
    /// would let a burst of parallel requests all pass the check before the
    /// first failure landed — the whole PIN space in one go. Charged up front,
    /// the burst gets exactly the free attempts and nothing more.
    pub fn begin_attempt(&self, keys: &[String], now: Instant) -> Result<(), Duration> {
        let mut entries = self.entries.lock().expect("throttle mutex");
        if let Some(wait) = wait_in(&entries, keys, now) {
            return Err(wait);
        }
        charge(&mut entries, keys, now);
        Ok(())
    }

    /// Restart the lock of a failed attempt from the moment it failed.
    ///
    /// [`begin_attempt`](Self::begin_attempt) stamps the lock before the PIN is
    /// checked, and bcrypt can take a noticeable share of the lock to answer — a
    /// slow CPU, or a busy one, could otherwise serve out most of a short lock
    /// while the verify is still running. The count is not raised again: the
    /// charge taken up front already stands for this failure.
    pub fn settle_failure(&self, keys: &[String], now: Instant) {
        let mut entries = self.entries.lock().expect("throttle mutex");
        for key in keys {
            let Some(entry) = entries.get_mut(key) else {
                continue;
            };
            entry.last_failure = entry.last_failure.max(now);
            if let Some(lock) = lock_duration(entry.count) {
                let until = now + lock;
                entry.locked_until = Some(entry.locked_until.map_or(until, |held| held.max(until)));
            }
        }
    }

    /// How long the caller must wait, if at all.
    #[cfg(test)]
    fn retry_after(&self, keys: &[String], now: Instant) -> Option<Duration> {
        wait_in(&self.entries.lock().expect("throttle mutex"), keys, now)
    }

    /// Record a rejected attempt and lengthen the lock.
    #[cfg(test)]
    fn record_failure(&self, keys: &[String], now: Instant) {
        charge(&mut self.entries.lock().expect("throttle mutex"), keys, now);
    }

    /// A correct PIN clears the record, so a user who eventually remembers their
    /// PIN is not left serving out a backoff.
    pub fn record_success(&self, keys: &[String]) {
        let mut entries = self.entries.lock().expect("throttle mutex");
        for key in keys {
            entries.remove(key);
        }
    }

    #[cfg(test)]
    fn tracked_keys(&self) -> usize {
        self.entries.lock().expect("throttle mutex").len()
    }
}

impl Failures {
    /// True once the entry is both unlocked and stale.
    fn is_forgettable(&self, now: Instant) -> bool {
        let unlocked = self.locked_until.is_none_or(|until| until <= now);
        unlocked && now.duration_since(self.last_failure) >= RESET_AFTER
    }
}

/// The longest lock across `keys`: being under backoff for the address is as
/// disqualifying as being under backoff for the username.
fn wait_in(entries: &HashMap<String, Failures>, keys: &[String], now: Instant) -> Option<Duration> {
    keys.iter()
        .filter_map(|key| entries.get(key))
        .filter_map(|entry| entry.locked_until)
        .filter(|until| *until > now)
        .map(|until| until - now)
        .max()
}

/// Count one failure against every key and lengthen its lock.
fn charge(entries: &mut HashMap<String, Failures>, keys: &[String], now: Instant) {
    if entries.len() > PRUNE_THRESHOLD {
        entries.retain(|_, entry| !entry.is_forgettable(now));
    }
    if entries.len() + keys.len() > MAX_TRACKED_KEYS {
        // Evict a quarter at once so the sort runs rarely under a flood.
        evict_oldest(entries, MAX_TRACKED_KEYS * 3 / 4);
    }

    for key in keys {
        let entry = entries.entry(key.clone()).or_insert(Failures {
            count: 0,
            last_failure: now,
            locked_until: None,
        });

        if entry.is_forgettable(now) {
            entry.count = 0;
            entry.locked_until = None;
        }

        entry.count = entry.count.saturating_add(1);
        entry.last_failure = now;
        if let Some(lock) = lock_duration(entry.count) {
            entry.locked_until = Some(now + lock);
        }
    }
}

/// Drop the least recently failed entries until at most `limit` remain.
fn evict_oldest(entries: &mut HashMap<String, Failures>, limit: usize) {
    let mut by_age: Vec<(Instant, String)> = entries
        .iter()
        .map(|(key, entry)| (entry.last_failure, key.clone()))
        .collect();
    by_age.sort_unstable();
    let excess = entries.len().saturating_sub(limit);
    for (_, key) in by_age.into_iter().take(excess) {
        entries.remove(&key);
    }
}

/// The lock imposed after `count` consecutive failures, or `None` while the
/// caller is still within the free attempts.
fn lock_duration(count: u32) -> Option<Duration> {
    if count < FREE_ATTEMPTS {
        return None;
    }
    let steps = count - FREE_ATTEMPTS;
    let secs = BASE_LOCK_SECS
        .checked_shl(steps)
        .unwrap_or(MAX_LOCK_SECS)
        .min(MAX_LOCK_SECS);
    Some(Duration::from_secs(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> Vec<String> {
        vec![username_key("kasir1"), address_key("192.168.1.20")]
    }

    #[test]
    fn the_first_two_failures_cost_nothing() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();

        throttle.record_failure(&keys(), now);
        assert!(throttle.retry_after(&keys(), now).is_none());

        throttle.record_failure(&keys(), now);
        assert!(throttle.retry_after(&keys(), now).is_none());
    }

    #[test]
    fn the_wait_doubles_with_every_further_failure_and_stops_at_the_cap() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        let mut waits = Vec::new();
        for _ in 0..12 {
            throttle.record_failure(&keys, now);
            waits.push(
                throttle
                    .retry_after(&keys, now)
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            );
        }

        assert_eq!(
            &waits[..3],
            &[0, 0, 5],
            "backoff starts on the third failure"
        );
        assert_eq!(&waits[3..8], &[10, 20, 40, 80, 160]);
        assert_eq!(
            waits[waits.len() - 1],
            MAX_LOCK_SECS,
            "the wait is capped, not unbounded"
        );
        for pair in waits.windows(2) {
            assert!(pair[1] >= pair[0], "the wait never shrinks: {waits:?}");
        }
    }

    #[test]
    fn a_locked_key_is_refused_until_the_lock_runs_out() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        for _ in 0..3 {
            throttle.record_failure(&keys, now);
        }

        assert!(throttle.retry_after(&keys, now).is_some());
        assert!(throttle
            .retry_after(&keys, now + Duration::from_secs(4))
            .is_some());
        assert!(
            throttle
                .retry_after(&keys, now + Duration::from_secs(6))
                .is_none(),
            "the lock expires on its own"
        );
    }

    /// Spraying one address across many usernames must still hit the address
    /// counter, and grinding one username from many addresses must still hit the
    /// username counter.
    #[test]
    fn either_side_of_the_pair_can_impose_the_wait() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();

        for name in ["a", "b", "c"] {
            throttle.record_failure(&[username_key(name), address_key("10.0.0.9")], now);
        }

        // A fresh username from the same address is still refused.
        assert!(throttle
            .retry_after(&[username_key("d"), address_key("10.0.0.9")], now)
            .is_some());
        // A different address is not.
        assert!(throttle
            .retry_after(&[username_key("d"), address_key("10.0.0.10")], now)
            .is_none());
    }

    #[test]
    fn a_successful_login_clears_the_record() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        for _ in 0..4 {
            throttle.record_failure(&keys, now);
        }
        assert!(throttle.retry_after(&keys, now).is_some());

        throttle.record_success(&keys);
        assert!(throttle.retry_after(&keys, now).is_none());
    }

    #[test]
    fn a_stale_counter_is_forgotten_so_backoff_does_not_accumulate_forever() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        for _ in 0..6 {
            throttle.record_failure(&keys, now);
        }

        // Long after the lock lapsed, the next mistake starts from zero again.
        let much_later = now + RESET_AFTER + Duration::from_secs(60);
        throttle.record_failure(&keys, much_later);
        assert!(throttle.retry_after(&keys, much_later).is_none());
    }

    #[test]
    fn cycling_keys_does_not_grow_the_map_without_bound() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();

        for i in 0..(PRUNE_THRESHOLD + 200) {
            throttle.record_failure(&[username_key(&format!("user{i}"))], now);
        }
        let before_sweep = throttle.tracked_keys();

        // One more failure long after everything went stale triggers the sweep.
        let much_later = now + RESET_AFTER + Duration::from_secs(60);
        throttle.record_failure(&[username_key("later")], much_later);

        assert!(
            throttle.tracked_keys() < before_sweep,
            "forgotten entries are swept once the map grows"
        );
    }

    /// Attempts that are all in flight at once — none has failed yet — still
    /// get only the free budget between them.
    #[test]
    fn a_parallel_burst_is_admitted_only_up_to_the_free_attempts() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        let admitted = (0..100)
            .filter(|_| throttle.begin_attempt(&keys, now).is_ok())
            .count();
        assert_eq!(admitted, FREE_ATTEMPTS as usize);
    }

    #[test]
    fn a_successful_attempt_takes_its_charge_back() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        for _ in 0..10 {
            throttle.begin_attempt(&keys, now).expect("admitted");
            throttle.record_success(&keys);
        }
        assert!(throttle.retry_after(&keys, now).is_none());
    }

    /// The lock runs from when the failure is known, not from when the attempt
    /// started: a verify slower than the lock must not leave the caller free.
    #[test]
    fn a_slow_failure_still_serves_its_whole_lock() {
        let throttle = LoginThrottle::new();
        let start = Instant::now();
        let keys = keys();

        for _ in 0..FREE_ATTEMPTS {
            throttle.begin_attempt(&keys, start).expect("admitted");
        }
        let failed_at = start + Duration::from_secs(BASE_LOCK_SECS + 2);
        throttle.settle_failure(&keys, failed_at);

        assert!(
            throttle
                .retry_after(&keys, failed_at + Duration::from_secs(1))
                .is_some(),
            "the lock is measured from the failure"
        );
        assert!(throttle
            .retry_after(&keys, failed_at + Duration::from_secs(BASE_LOCK_SECS + 1))
            .is_none());
    }

    #[test]
    fn settling_a_failure_does_not_count_it_twice() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();
        let keys = keys();

        for _ in 0..(FREE_ATTEMPTS - 1) {
            throttle.begin_attempt(&keys, now).expect("admitted");
            throttle.settle_failure(&keys, now);
        }
        assert!(throttle.retry_after(&keys, now).is_none());
    }

    /// A huge username is stored as a fixed-size hash, still distinct per name.
    #[test]
    fn a_huge_username_is_kept_as_a_short_key() {
        let huge = "x".repeat(1 << 20);
        let key = username_key(&huge);
        assert!(key.len() <= 2 + 64, "key is {} bytes", key.len());
        assert_eq!(key, username_key(&huge.to_uppercase()));
        assert_ne!(key, username_key(&format!("{huge}y")));
        assert_eq!(username_key("kasir1"), "u:kasir1");
        assert!(address_key(&"1".repeat(10_000)).len() <= 2 + 64);
    }

    /// Fresh keys that are not yet stale still cannot grow the map past its cap.
    #[test]
    fn the_map_never_holds_more_than_the_cap() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();

        for i in 0..(MAX_TRACKED_KEYS + 500) {
            let at = now + Duration::from_millis(i as u64);
            throttle.record_failure(&[username_key(&format!("user{i}"))], at);
        }
        assert!(throttle.tracked_keys() <= MAX_TRACKED_KEYS);

        // The newest entry survives; the oldest went first.
        let entries = throttle.entries.lock().unwrap();
        assert!(entries.contains_key(&username_key(&format!("user{}", MAX_TRACKED_KEYS + 499))));
        assert!(!entries.contains_key(&username_key("user0")));
    }

    /// A username differing only in case must not get a fresh attempt budget.
    #[test]
    fn the_username_counter_ignores_case_and_padding() {
        assert_eq!(username_key("Admin"), username_key("  admin "));
    }

    #[test]
    fn one_username_cannot_lock_another() {
        let throttle = LoginThrottle::new();
        let now = Instant::now();

        for _ in 0..5 {
            throttle.record_failure(&[username_key("kasir1")], now);
        }

        assert!(throttle
            .retry_after(&[username_key("kasir1")], now)
            .is_some());
        assert!(throttle
            .retry_after(&[username_key("admin")], now)
            .is_none());
    }
}

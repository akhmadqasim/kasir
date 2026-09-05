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
    format!("u:{}", username.trim().to_lowercase())
}

/// Key for the client-address side of the count.
pub fn address_key(address: &str) -> String {
    format!("a:{address}")
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// How long the caller must wait, if at all.
    ///
    /// The longest lock across all keys wins: being under backoff for the
    /// address is as disqualifying as being under backoff for the username.
    pub fn retry_after(&self, keys: &[String], now: Instant) -> Option<Duration> {
        let entries = self.entries.lock().expect("throttle mutex");
        keys.iter()
            .filter_map(|key| entries.get(key))
            .filter_map(|entry| entry.locked_until)
            .filter(|until| *until > now)
            .map(|until| until - now)
            .max()
    }

    /// Record a rejected attempt and lengthen the lock.
    pub fn record_failure(&self, keys: &[String], now: Instant) {
        let mut entries = self.entries.lock().expect("throttle mutex");

        if entries.len() > PRUNE_THRESHOLD {
            entries.retain(|_, entry| !entry.is_forgettable(now));
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

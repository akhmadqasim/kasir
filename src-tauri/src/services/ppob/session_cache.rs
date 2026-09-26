//! A cache of something read from the Mitra session, which the session ending
//! must be able to empty for good.
//!
//! Emptying the slot is not enough on its own. A rebuild that was already
//! waiting on Mitra when the shop logged out (or switched accounts) finishes
//! afterwards and stores what the previous account's session answered, and
//! the next account is then served from it. So every forget also moves the
//! cache to a new generation, a rebuild takes a [`Ticket`] for the generation
//! it started in, and a store with a ticket from an earlier generation is
//! dropped.

use std::sync::Mutex;

/// The generation a rebuild started in. Taken before the first upstream
/// request, handed back to [`SessionCache::store`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Ticket(u64);

struct Slot<T> {
    generation: u64,
    value: T,
}

/// `T` is the cache's own shape; `T::default()` is its empty state.
///
/// A plain `std` mutex: it is never held across an `.await`, and a forget has
/// to be callable from synchronous code. A poisoned lock reads as a miss and
/// stores nothing, the way the caches treated it before.
pub(crate) struct SessionCache<T> {
    slot: Mutex<Slot<T>>,
}

impl<T: Default> SessionCache<T> {
    pub(crate) fn new() -> Self {
        Self {
            slot: Mutex::new(Slot {
                generation: 0,
                value: T::default(),
            }),
        }
    }

    /// The generation a rebuild starting now belongs to.
    pub(crate) fn ticket(&self) -> Ticket {
        Ticket(self.slot.lock().map(|slot| slot.generation).unwrap_or(0))
    }

    /// Read the cached value, `None` when the lock is poisoned.
    pub(crate) fn read<R>(&self, read: impl FnOnce(&T) -> R) -> Option<R> {
        self.slot.lock().ok().map(|slot| read(&slot.value))
    }

    /// Write what a rebuild found, unless the cache was forgotten since the
    /// rebuild took `ticket`. Returns whether it was written.
    pub(crate) fn store(&self, ticket: Ticket, write: impl FnOnce(&mut T)) -> bool {
        let Ok(mut slot) = self.slot.lock() else {
            return false;
        };
        if slot.generation != ticket.0 {
            return false;
        }
        write(&mut slot.value);
        true
    }

    /// Empty the cache and turn away every rebuild already in flight.
    pub(crate) fn forget(&self) {
        if let Ok(mut slot) = self.slot.lock() {
            slot.generation = slot.generation.wrapping_add(1);
            slot.value = T::default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rebuild_started_before_a_forget_does_not_store() {
        let cache: SessionCache<Option<&str>> = SessionCache::new();
        let in_flight = cache.ticket();

        cache.forget();

        assert!(!cache.store(in_flight, |value| *value = Some("akun lama")));
        assert_eq!(cache.read(|value| *value), Some(None));
    }

    #[test]
    fn a_rebuild_started_after_a_forget_stores() {
        let cache: SessionCache<Option<&str>> = SessionCache::new();
        cache.forget();
        let ticket = cache.ticket();

        assert!(cache.store(ticket, |value| *value = Some("akun baru")));
        assert_eq!(cache.read(|value| *value), Some(Some("akun baru")));
    }

    #[test]
    fn forget_empties_what_was_stored() {
        let cache: SessionCache<Vec<u8>> = SessionCache::new();
        let ticket = cache.ticket();
        cache.store(ticket, |value| value.push(1));

        cache.forget();

        assert_eq!(cache.read(Vec::len), Some(0));
    }
}

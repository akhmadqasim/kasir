-- Migration 026: at most one open shift per user, enforced by the database.
--
-- `services::shifts::open` serialises its look-then-insert with an in-process
-- mutex, which cannot see a second process on the same file (or a row written
-- by hand). A partial UNIQUE index makes a second open shift for the same user
-- impossible, whoever writes it.
--
-- The index cannot be created while duplicates exist, and an install that
-- predates the mutex may have some. They are resolved without deleting
-- anything: for each user, the open shift with the most recent activity (a
-- sale, a refund or a cash movement booked to it, else its opening time; ties
-- go to the newer id) stays open — that is the one the till has been booking
-- to — and every other open shift of that user is closed now, with its
-- `closing_cash` left NULL (nobody counted that drawer) and a note saying why.
-- Their sales, refunds and cash flows stay attached to them, so each closed
-- shift's summary still adds up; only the drawer count is missing, which is
-- the truth. Aborting instead would leave the app unable to start until
-- someone edited the database by hand.

WITH open_shift_activity AS (
  SELECT
    s.id,
    s.user_id,
    MAX(
      s.opened_at,
      COALESCE((SELECT MAX(t.created_at) FROM transactions t WHERE t.shift_id = s.id), ''),
      COALESCE((SELECT MAX(r.created_at) FROM refunds r WHERE r.shift_id = s.id), ''),
      COALESCE((SELECT MAX(c.created_at) FROM cash_flows c WHERE c.shift_id = s.id), '')
    ) AS last_activity
  FROM shifts s
  WHERE s.status = 'open'
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_activity DESC, id DESC) AS recency
  FROM open_shift_activity
)
UPDATE shifts
SET status = 'closed',
    closed_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
    notes = CASE
      WHEN notes IS NULL OR notes = ''
        THEN 'Ditutup otomatis saat pembaruan: kasir ini punya lebih dari satu shift terbuka. Uang laci tidak dihitung.'
      ELSE notes || char(10) || 'Ditutup otomatis saat pembaruan: kasir ini punya lebih dari satu shift terbuka. Uang laci tidak dihitung.'
    END
WHERE id IN (SELECT id FROM ranked WHERE recency > 1);

CREATE UNIQUE INDEX idx_shifts_one_open_per_user ON shifts(user_id) WHERE status = 'open';

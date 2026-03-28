-- Migration 008: Shift kasir & cash flows

CREATE TABLE shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed'))
);

CREATE TABLE cash_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('in', 'out')),
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shifts_user ON shifts(user_id);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_opened ON shifts(opened_at);
CREATE INDEX idx_cash_flows_shift ON cash_flows(shift_id);

ALTER TABLE transactions ADD COLUMN shift_id INTEGER REFERENCES shifts(id);

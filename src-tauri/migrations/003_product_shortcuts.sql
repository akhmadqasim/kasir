CREATE TABLE IF NOT EXISTS product_shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE REFERENCES products(id),
    select_count INTEGER NOT NULL DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT 0,
    last_selected_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_shortcuts_product ON product_shortcuts(product_id);
CREATE INDEX IF NOT EXISTS idx_product_shortcuts_rank ON product_shortcuts(is_pinned DESC, select_count DESC);

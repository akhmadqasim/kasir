//! Helpers for building SQL from user text.

use sea_orm::sea_query::{LikeExpr, SimpleExpr};
use sea_orm::ColumnTrait;

/// The escape character paired with [`escape_like`]: every `LIKE` that takes a
/// pattern built from it must say `ESCAPE '\'`. The query-builder paths get
/// that from [`contains_literal`] and [`starts_with_literal`]; raw SQL writes
/// `ESCAPE '{LIKE_ESCAPE}'` next to the bound pattern.
pub const LIKE_ESCAPE: char = '\\';

/// Escapes `%`, `_` and the escape character itself, so user text is matched
/// literally inside a `LIKE` pattern. Without it a search for `50%` matched
/// every row containing `50`, and `_` matched any single character.
pub fn escape_like(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if c == '%' || c == '_' || c == LIKE_ESCAPE {
            escaped.push(LIKE_ESCAPE);
        }
        escaped.push(c);
    }
    escaped
}

/// `col LIKE '%text%'`, with `text` matched literally. Use instead of
/// `ColumnTrait::contains`, which splices the text into the pattern raw.
pub fn contains_literal<C: ColumnTrait>(col: C, text: &str) -> SimpleExpr {
    col.like(LikeExpr::new(format!("%{}%", escape_like(text))).escape(LIKE_ESCAPE))
}

/// `col LIKE 'text%'`, with `text` matched literally. Use instead of
/// `ColumnTrait::starts_with`.
pub fn starts_with_literal<C: ColumnTrait>(col: C, text: &str) -> SimpleExpr {
    col.like(LikeExpr::new(format!("{}%", escape_like(text))).escape(LIKE_ESCAPE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::products;
    use sea_orm::{DbBackend, EntityTrait, QueryFilter, QueryTrait};

    #[test]
    fn wildcards_and_the_escape_character_are_escaped() {
        assert_eq!(escape_like("TRX-2026"), "TRX-2026");
        assert_eq!(escape_like("50%"), "50\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("a\\b"), "a\\\\b");
    }

    #[test]
    fn the_literal_helpers_carry_their_escape_clause() {
        let sql = |expr| {
            products::Entity::find()
                .filter(expr)
                .build(DbBackend::Sqlite)
                .to_string()
        };
        assert!(sql(contains_literal(products::Column::Name, "50%"))
            .ends_with(r#"WHERE "products"."name" LIKE '%50\%%' ESCAPE '\'"#));
        assert!(sql(starts_with_literal(products::Column::Sku, "a_b"))
            .ends_with(r#"WHERE "products"."sku" LIKE 'a\_b%' ESCAPE '\'"#));
    }
}

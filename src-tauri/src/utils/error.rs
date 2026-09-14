use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Database(#[from] sea_orm::DbErr),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Validation(String),

    #[error("{0}")]
    Auth(String),

    #[error("{0}")]
    Forbidden(String),

    /// A third party we depend on (right now: the Mitra Indogrosir PPOB
    /// upstream) refused or lost its own authentication. This is never about
    /// *our* session — mapping it to 401 would make the frontend's "the
    /// session is gone, log out" handler fire for a problem that has nothing
    /// to do with the cashier's login.
    #[error("{0}")]
    Upstream(String),

    #[error("{0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

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

    /// The request reached (or may have reached) the third party, but no
    /// usable answer came back: a timeout after sending, a dropped connection,
    /// a body that is not JSON. Unlike [`AppError::Upstream`] nobody knows
    /// whether it acted — for a PPOB payment the money may already be spent,
    /// so the caller must not treat this as a failure it can simply retry.
    #[error("{0}")]
    UpstreamUncertain(String),

    #[error("{0}")]
    Internal(String),
}

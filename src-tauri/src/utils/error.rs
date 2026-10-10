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

    /// Mitra answered a purchase with `ADVICE`: the payment was handed to the
    /// biller (PLN, mostly) but its final result is not known yet. The money
    /// is usually already debited and the token follows later, so this is an
    /// [`AppError::UpstreamUncertain`] that also carries Mitra's own reference
    /// (`advice_id` / `uid`, as JSON text) for reconciling it from the history.
    #[error("Mitra: ADVICE (pembayaran terkirim, hasil akhir belum ada)")]
    UpstreamAdvice(Option<String>),

    /// The third party gave no usable answer at all: no connection, a timeout,
    /// a body that is not JSON. Its own variant, so callers can tell "nobody
    /// answered" from "Mitra answered and refused" without reading the text.
    /// `maybe_sent` is true when the request may have reached Mitra (a timeout
    /// or reset after sending, an unreadable answer): for a purchase that is
    /// as uncertain as [`AppError::UpstreamUncertain`]. False only when the
    /// connect itself failed, so Mitra never saw the request.
    #[error("{message}")]
    UpstreamUnreachable { message: String, maybe_sent: bool },

    #[error("{0}")]
    Internal(String),

    /// The current PIN given to change one's own PIN does not match. Its own
    /// case so the route charges only this to the PIN throttle. A 422 like
    /// `Validation`, never a 401: the frontend logs out on every 401.
    #[error("PIN saat ini tidak sesuai")]
    WrongCurrentPin,
}

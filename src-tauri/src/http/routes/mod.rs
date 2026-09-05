//! URL → service. Nothing else.
//!
//! A handler in here is allowed to do four things: pull the [`Actor`] the
//! session middleware left in the extensions, deserialise the input, call one
//! service function, and serialise what comes back. If a handler ever needs a
//! fifth thing, that thing is a business rule and belongs in `services/`.
//!
//! Routes are grouped by who may call them rather than by resource, because that
//! is what decides which middleware wraps them. Each resource module contributes
//! to whichever of the three groups it needs:
//!
//! | group | wrapped by | who gets in |
//! |---|---|---|
//! | `public` | nothing | anyone who can reach the port |
//! | `session` | `require_session` | any logged-in user |
//! | `admin` | `require_session` then `require_admin` | admins |
//!
//! The grouping is what makes an unguarded route visible: adding an endpoint to
//! the wrong list is a one-line diff in a table, not a missing call buried in a
//! handler body.
//!
//! [`Actor`]: crate::domain::Actor

pub mod auth;
pub mod categories;
pub mod onboarding;
pub mod products;

use axum::Router;

use crate::http::{middleware, AppState};

pub fn api_router(state: AppState) -> Router<AppState> {
    let session_layer =
        axum::middleware::from_fn_with_state(state.clone(), middleware::require_session);
    let admin_layer = axum::middleware::from_fn(middleware::require_admin);

    let public = Router::new()
        .merge(auth::public())
        .merge(onboarding::public());

    let session = Router::new()
        .merge(auth::session())
        .merge(products::session())
        .merge(categories::session())
        .route_layer(session_layer.clone());

    // The order matters and is the reverse of how it reads: a `route_layer`
    // wraps what is already there, so the *last* one applied runs *first*.
    // `require_admin` reads the `Actor` that `require_session` inserts, so
    // `require_session` has to be the outer of the two.
    let admin = Router::new()
        .merge(products::admin())
        .merge(categories::admin())
        .route_layer(admin_layer)
        .route_layer(session_layer);

    Router::new().merge(public).merge(session).merge(admin)
}

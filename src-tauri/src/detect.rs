//! Detection rules, ported from `tg_join_cleaner.py`.
//!
//! Kept free of network code so the rules can be unit-tested and shared by
//! the scan and the pre-delete re-check.

use grammers_client::tl;

/// What kind of chat a dialog is, reduced to what the rules need.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatKind {
    User { is_self: bool, is_bot: bool },
    /// Groups, channels and communities.
    Other,
}

/// Rule 2: Telegram marks these as a distinct service action, so this is an
/// exact match, never a text search on "joined Telegram".
pub fn is_join_notice(action: Option<&tl::enums::MessageAction>) -> bool {
    matches!(action, Some(tl::enums::MessageAction::ContactSignUp))
}

/// Rules 1 and 2: a private chat with a real user (deleted accounts count),
/// whose latest message is the join notice. Cheap, needs no extra request.
pub fn passes_cheap_check(
    kind: ChatKind,
    last_action: Option<&tl::enums::MessageAction>,
) -> bool {
    match kind {
        ChatKind::User { is_self: false, is_bot: false } => is_join_notice(last_action),
        _ => false,
    }
}

/// Rule 3: after fetching up to 2 messages, the join notice must be the only one.
pub fn passes_strict_check(recent_actions: &[Option<tl::enums::MessageAction>]) -> bool {
    recent_actions.len() == 1 && is_join_notice(recent_actions[0].as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tl::enums::MessageAction as A;

    const USER: ChatKind = ChatKind::User { is_self: false, is_bot: false };

    #[test]
    fn matches_join_notice_from_user() {
        assert!(passes_cheap_check(USER, Some(&A::ContactSignUp)));
    }

    #[test]
    fn skips_groups_bots_and_saved_messages() {
        let join = Some(&A::ContactSignUp);
        assert!(!passes_cheap_check(ChatKind::Other, join));
        assert!(!passes_cheap_check(ChatKind::User { is_self: false, is_bot: true }, join));
        assert!(!passes_cheap_check(ChatKind::User { is_self: true, is_bot: false }, join));
    }

    #[test]
    fn skips_regular_and_other_service_messages() {
        assert!(!passes_cheap_check(USER, None));
        assert!(!passes_cheap_check(USER, Some(&A::Empty)));
    }

    #[test]
    fn strict_check_needs_join_notice_as_only_message() {
        assert!(passes_strict_check(&[Some(A::ContactSignUp)]));
        assert!(!passes_strict_check(&[]));
        assert!(!passes_strict_check(&[None]));
        assert!(!passes_strict_check(&[Some(A::ContactSignUp), None]));
        assert!(!passes_strict_check(&[None, Some(A::ContactSignUp)]));
    }
}
